import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertCircle, Check, ChevronDown, Copy, Sparkles } from "lucide-react";
import type { ChatMessage } from "../types";

/** Turns "[Source Block #2]" into a markdown link we can render as a clickable chip. */
const withCitations = (md: string) => md.replace(/\[Source Block #(\d+)[^\]]*\]/gi, (_m, n) => `[${n}](#source-${n})`);

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
            {withCitations(message.content)}
          </ReactMarkdown>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sources.length > 0 && (
            <button
              onClick={() => setShowSources((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900"
            >
              Sources ({sources.length})
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

        {showSources && (
          <div className="rise mt-3 space-y-2">
            {sources.map((s, i) => {
              const open = openIdx === i;
              return (
                <div key={s.id} className={`rounded-xl border bg-white transition-colors ${open ? "border-indigo-300" : "border-stone-200"}`}>
                  <button onClick={() => setOpenIdx(open ? null : i)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-[11px] font-semibold text-indigo-700">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-stone-800">Page {s.pageNumber}</span>
                    {typeof s.score === "number" && (
                      <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-stone-500">
                        {Math.round(s.score * 100)}% match
                      </span>
                    )}
                  </button>
                  {open && <p className="border-t border-stone-100 px-3.5 py-3 text-sm leading-relaxed text-stone-600">{s.text}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
