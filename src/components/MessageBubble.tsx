import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertCircle, Check, ChevronDown, Copy, Sparkles } from "lucide-react";
import type { ChatMessage } from "../types";

/** Turns "[Source Block #2]" (or "[Source Block #1, #3]") into markdown links we render as clickable chips. */
const withCitations = (md: string, streaming?: boolean) => {
  // while the answer is still streaming, hide a half-written marker such as "[Source Blo"
  const text = streaming ? md.replace(/\[S[^\]]{0,30}$/, "") : md;
  return text.replace(/\[Source Blocks?\s*([^\]]*)\]/gi, (_m, inner: string) => {
    const nums = [...inner.matchAll(/\d+/g)].map((x) => x[0]);
    return nums.map((n) => `[${n}](#source-${n})`).join("");
  });
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Highlights the search words inside a retrieved passage so the user sees why it matched. */
function Highlighted({ text, terms }: { text: string; terms?: string[] }) {
  const usable = (terms ?? []).filter((t) => t.length >= 3);
  if (!usable.length) return <>{text}</>;
  let re: RegExp;
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.map(escapeRegExp).join("|")})[\\p{L}\\p{N}]*`, "giu");
  } catch {
    return <>{text}</>;
  }
  const parts: (string | { mark: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push({ mark: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-stone-800">
            {p.mark}
          </mark>
        )
      )}
    </>
  );
}

export function TypingBubble() {
  return (
    <div className="rise flex gap-3">
      <Avatar />
      <div className="flex items-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-stone-400" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (message.role === "user") {
    return (
      <div className="rise flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-stone-900 px-4 py-2.5 text-[0.9375rem] leading-relaxed text-white sm:max-w-[70%]">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.error) {
    return (
      <div className="rise flex gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertCircle className="h-4 w-4" />
        </div>
        <div className="max-w-[85%] rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-0.5 text-red-600">{message.content}</p>
        </div>
      </div>
    );
  }

  const sources = message.sources ?? [];
  // only show the passages the answer actually used (older messages without that info show all)
  const visible = sources.map((s, i) => ({ s, i })).filter(({ i }) => !message.cited || message.cited.includes(i + 1));
  const openCitation = (n: number) => {
    setShowSources(true);
    setOpenIdx(n - 1);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked, ignore */
    }
  };

  return (
    <div className="rise flex gap-3">
      <Avatar />
      <div className="min-w-0 max-w-full flex-1">
        <div className="answer-md">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => {
                const m = href?.match(/^#source-(\d+)$/);
                if (!m) return <span>{children}</span>;
                const n = Number(m[1]);
                return (
                  <button
                    onClick={() => openCitation(n)}
                    className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-md bg-indigo-50 px-1 align-middle text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                    title={sources[n - 1] ? `Source ${n}, page ${sources[n - 1].pageNumber}` : `Source ${n}`}
                  >
                    {n}
                  </button>
                );
              },
            }}
          >
            {withCitations(message.content, message.streaming)}
          </ReactMarkdown>
        </div>

        {!message.streaming && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {visible.length > 0 && (
            <button
              onClick={() => setShowSources((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900"
            >
              Sources ({visible.length})
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSources ? "rotate-180" : ""}`} />
            </button>
          )}
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        )}

        {showSources && !message.streaming && (
          <div className="rise mt-3 space-y-2">
            {visible.map(({ s, i }) => {
              const open = openIdx === i;
              return (
                <div key={s.id} className={`rounded-xl border bg-white transition-colors ${open ? "border-indigo-300" : "border-stone-200"}`}>
                  <button onClick={() => setOpenIdx(open ? null : i)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-[11px] font-semibold text-indigo-700">
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium text-stone-800">
                      Page {s.pageNumber}
                      {s.docName ? <span className="font-normal text-stone-400"> · {s.docName}</span> : null}
                    </span>
                    {typeof s.score === "number" && (
                      <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-stone-500">
                        {Math.round(s.score * 100)}% match
                      </span>
                    )}
                  </button>
                  {open && (
                    <p className="border-t border-stone-100 px-3.5 py-3 text-sm leading-relaxed text-stone-600">
                      <Highlighted text={s.text} terms={message.terms} />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
