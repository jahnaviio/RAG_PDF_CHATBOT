import { neon } from "@neondatabase/serverless";
import { cfg, databaseUrl } from "./config.js";
import { HttpError } from "./errors.js";

type Sql = ReturnType<typeof neon>;
let sqlClient: Sql | null = null;

function getSql(): Sql {
  const url = databaseUrl();
  if (!url) {
    throw new HttpError(500, "DATABASE_URL is not configured. Add a Neon Postgres database in Vercel (Storage tab) and redeploy.");
  }
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

/** Parameterised query helper. Always pass user input through `params`, never string concatenation. */
export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await (getSql() as any).query(text, params);
  return rows as T[];
}

/** pgvector text format: [0.1,0.2,...] */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

/** Postgres text[] literal, used with `$n::text[]`. */
export const toPgTextArray = (items: string[]) =>
  "{" + items.map((s) => `"${s.replace(/(["\\])/g, "\\$1")}"`).join(",") + "}";

/**
 * The whole schema. It is applied automatically (idempotent) on the first request
 * after a cold start, so setup is just "provide DATABASE_URL".
 */
export const SCHEMA_STATEMENTS: string[] = [
  `create extension if not exists vector`,

  `create table if not exists users (
     id          text primary key,
     email       text not null,
     name        text,
     picture     text,
     created_at  timestamptz not null default now(),
     last_login  timestamptz not null default now()
   )`,

  `create table if not exists documents (
     id               text primary key,
     user_id          text not null,
     name             text not null,
     size             integer not null default 0,
     page_count       integer not null default 0,
     chunk_count      integer not null default 0,
     total_characters integer not null default 0,
     status           text not null default 'processing',
     created_at       timestamptz not null default now()
   )`,
  `create index if not exists documents_user_idx on documents (user_id, created_at desc)`,

  `create table if not exists chunks (
     id          bigserial primary key,
     doc_id      text not null references documents(id) on delete cascade,
     user_id     text not null,
     chunk_index integer not null,
     page_number integer not null,
     content     text not null,
     embedding   vector(${cfg.embeddingDims}) not null,
     tsv         tsvector generated always as (to_tsvector('english', content)) stored
   )`,
  `create unique index if not exists chunks_doc_chunk_uq on chunks (doc_id, chunk_index)`,
  `create index if not exists chunks_user_idx on chunks (user_id)`,
  `create index if not exists chunks_tsv_idx on chunks using gin (tsv)`,

  `create table if not exists messages (
     seq        bigserial primary key,
     id         text not null unique,
     user_id    text not null,
     scope      text not null,
     role       text not null,
     content    text not null,
     sources    jsonb,
     cited      jsonb,
     terms      jsonb,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists messages_scope_idx on messages (user_id, scope, seq)`,
  `create index if not exists messages_user_time_idx on messages (user_id, created_at)`,

  `create table if not exists request_logs (
     id            bigserial primary key,
     user_id       text,
     kind          text not null,
     scope         text,
     mode          text,
     status        integer,
     latency_ms    integer,
     retrieval_ms  integer,
     ttft_ms       integer,
     prompt_tokens integer,
     output_tokens integer,
     error         text,
     created_at    timestamptz not null default now()
   )`,
  `create index if not exists request_logs_time_idx on request_logs (created_at)`,
];

let schemaPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await query(statement);
      }
    })().catch((err) => {
      schemaPromise = null; // retry on the next request
      throw err;
    });
  }
  return schemaPromise;
}
