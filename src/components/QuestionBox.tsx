import React, { useState } from "react";
import { Send, Sparkles, HelpCircle } from "lucide-react";

interface QuestionBoxProps {
  onAsk: (question: string) => void;
  disabled: boolean;
  loading: boolean;
}

export default function QuestionBox({ onAsk, disabled, loading }: QuestionBoxProps) {
  const [question, setQuestion] = useState("");

  const presets = [
    "Summarize this document.",
    "What are the key points?",
    "What are the main conclusions?",
    "Explain the core technical requirements.",
    "Are there any specific skills mentioned?"
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim().length === 0 || disabled || loading) return;
    onAsk(question.trim());
    setQuestion("");
  };

  const handlePresetClick = (preset: string) => {
    if (disabled || loading) return;
    onAsk(preset);
  };

  return (
    <div id="question_box_container" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-gray-400" />
        <h2 id="question_box_title" className="text-sm font-medium uppercase tracking-wider text-gray-400">
          Ask Document Intelligence
        </h2>
      </div>

      <form id="question_form" onSubmit={handleSubmit} className="relative">
        <textarea
          id="question_textarea"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={disabled || loading}
          placeholder={
            disabled 
              ? "Please upload and process a PDF document above to begin asking questions." 
              : "Type your query here (e.g., 'What are the main conclusions in section 2?')..."
          }
          className="w-full text-sm text-gray-800 placeholder-gray-400 border border-gray-200 rounded-xl p-4 pr-12 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 min-h-[100px] resize-none disabled:bg-gray-50/50 disabled:cursor-not-allowed transition-all"
        />
        <button
          id="ask_submit_btn"
          type="submit"
          disabled={disabled || loading || question.trim().length === 0}
          className="absolute right-3.5 bottom-3.5 p-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 active:bg-black disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
          title="Ask question"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Recommended Qs Presets */}
      <div id="preset_questions_wrapper" className="mt-5">
        <p className="text-xs text-gray-400 font-medium mb-2.5 flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5" />
          Example Quick Queries:
        </p>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              id={`preset_${preset.replace(/\s+/g, '_').toLowerCase()}`}
              onClick={() => handlePresetClick(preset)}
              disabled={disabled || loading}
              className="text-xs text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-lg hover:text-gray-900 hover:border-gray-300 hover:bg-gray-100/50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-50 disabled:hover:border-gray-100 disabled:hover:text-gray-600 transition-all text-left"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
