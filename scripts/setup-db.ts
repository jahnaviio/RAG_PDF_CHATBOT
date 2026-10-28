/**
 * Optional: creates the tables now instead of waiting for the first request.
 * The app does this automatically, so you only need this to check your DATABASE_URL.
 *
 *   npm run db:setup
 */
import "dotenv/config";
import { ensureSchema, query } from "../src/server/db.js";

await ensureSchema();
const tables = await query<{ table_name: string }>(
  `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
);
console.log("Database ready. Tables:", tables.map((t) => t.table_name).join(", "));
