import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

interface ComposerProps {
  disabled: boolean;
  busy: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}

export default function Composer({ disabled, busy, placeholder, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // auto-grow up to ~6 lines
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const canSend = !disabled && !busy && text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="border-t border-stone-200 bg-[#fafaf9]/90 px-4 pb-4 pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border border-stone-300 bg-white p-2 shadow-sm transition-shadow focus-within:border-indigo-500 focus-within:shadow-md">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-[0.9375rem] text-stone-900 placeholder-stone-400 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Send question"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
          >
            <ArrowUp className="h-4.5 w-4.5" />
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-stone-400">Answers use your PDF first, then AI knowledge when needed. Enter to send, Shift+Enter for a new line.</p>
      </div>
    </div>
  );
}
