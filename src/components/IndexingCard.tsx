import { Check, Loader2 } from "lucide-react";
import type { IndexProgress, IndexStage } from "../types";

const STEPS: { id: IndexStage; label: string }[] = [
  { id: "reading", label: "Read PDF" },
  { id: "chunking", label: "Split into chunks" },
  { id: "embedding", label: "Build search index" },
];

export default function IndexingCard({ progress }: { progress: IndexProgress }) {
  const current = STEPS.findIndex((s) => s.id === progress.stage);
  return (
    <div className="rise w-full rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-600" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">{progress.fileName}</p>
          <p className="text-sm text-stone-500">{progress.message}</p>
        </div>
        <span className="ml-auto font-mono text-sm tabular-nums text-stone-500">{progress.percent}%</span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-indigo-600 transition-all duration-300" style={{ width: `${progress.percent}%` }} />
      </div>

      <ol className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={step.id} className={`flex items-center gap-2 ${done || active ? "text-stone-900" : "text-stone-400"}`}>
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-indigo-600 text-white" : "bg-stone-200 text-stone-500"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
