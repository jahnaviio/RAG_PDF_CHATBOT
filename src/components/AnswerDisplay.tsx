import { useState } from "react";
import { Sparkles, Clipboard, Check, ChevronDown, ChevronUp, FileText, Bookmark } from "lucide-react";
import { QueryResponse } from "../types";

interface AnswerDisplayProps {
  response: QueryResponse | null;
  loading: boolean;
}

export default function AnswerDisplay({ response, loading }: AnswerDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  const handleCopy = () => {
    if (!response) return;
    navigator.clipboard.writeText(response.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Safe and precise light Markdown parsing helper inside React
  const renderFormattedAnswer = (text: string) => {
    if (!text) return null;

    const lines = text.split("\n");
    return lines.map((line, idx) => {
      // 1. Headers (### or ##)
      if (line.startsWith("### ")) {
        return (
          <h4 key={idx} className="text-sm font-semibold text-gray-900 mt-4 mb-2">
            {parseBoldText(line.replace("### ", ""))}
          </h4>
        );
      }
      if (line.startsWith("## ") || line.startsWith("# ")) {
        return (
          <h3 key={idx} className="text-base font-semibold text-gray-900 mt-5 mb-2.5 border-b border-gray-100 pb-1">
            {parseBoldText(line.replace(/^#+\s+/, ""))}
          </h3>
        );
      }

      // 2. Bullet list item
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        const cleanItem = line.trim().replace(/^[-*]\s+/, "");
        return (
          <li key={idx} className="ml-5 list-disc text-sm text-gray-700 mb-1.5 leading-relaxed">
            {parseBoldText(cleanItem)}
          </li>
        );
      }

      // 3. Numbered list item
      if (/^\s*\r?\n?\d+\.\s+/.test(line)) {
        const cleanItem = line.trim().replace(/^\d+\.\s+/, "");
        return (
          <li key={idx} className="ml-5 list-decimal text-sm text-gray-700 mb-1.5 leading-relaxed">
            {parseBoldText(cleanItem)}
          </li>
        );
      }

      // 4. Standard blank lines
      if (line.trim() === "") {
        return <div key={idx} className="h-2.5" />;
      }

      // 5. Standard paragraph line
      return (
        <p key={idx} className="text-sm text-gray-700 mb-2 leading-relaxed text-justify">
          {parseBoldText(line)}
        </p>
      );
    });
  };

  // Regex parser to replace **text** with standard <strong> nodes, and format citations
  const parseBoldText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\[Source Block #\d+.*?\])/g);
    return parts.map((part, i) => {
      // Match markdown bolding
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
      }
      
      // Match citation references like "[Source Block #1]"
      const citationMatch = part.match(/^\[Source Block #(\d+)(.*?)\]$/);
      if (citationMatch) {
         const blockIndex = parseInt(citationMatch[1], 10) - 1;
         return (
           <span
             key={i}
             onClick={() => {
               setShowSources(true);
               const targetItem = response?.retrievedChunks[blockIndex];
               if (targetItem) {
                 setActiveSourceId(targetItem.id);
                 document.getElementById(targetItem.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
               }
             }}
             className="inline-flex items-center gap-0.5 font-semibold text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100/80 px-1.5 py-0.5 rounded cursor-pointer transition-colors border border-indigo-100"
             title="Click to view parsed document chunk"
           >
             <Bookmark className="w-2.5 h-2.5 shrink-0" />
             Block #{citationMatch[1]}
           </span>
         );
      }

      return part;
    });
  };

  return (
    <div id="answer_display_container" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col gap-5">
      <div className="flex items-center justify-between border-b border-gray-50 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gray-50 rounded-lg text-gray-700 border border-gray-100">
            <Sparkles className="w-4 h-4 text-gray-800" />
          </div>
          <div>
            <h3 id="answer_title" className="text-sm font-semibold text-gray-900">
              Response Intelligence
            </h3>
            {response && (
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                Context-grounded query matching
              </p>
            )}
          </div>
        </div>

        {response && !loading && (
          <button
            id="copy_answer_btn"
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 border border-gray-100 hover:border-gray-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-500" />
                <span className="text-green-600 font-medium select-none">Copied!</span>
              </>
            ) : (
              <>
                <Clipboard className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {loading ? (
        <div id="answer_skeleton" className="animate-pulse flex flex-col gap-3 py-2">
          <div className="h-4 bg-gray-100 rounded w-1/4"></div>
          <div className="h-3.5 bg-gray-100 rounded w-full"></div>
          <div className="h-3.5 bg-gray-100 rounded w-full"></div>
          <div className="h-3.5 bg-gray-100 rounded w-5/6"></div>
          <div className="h-3.5 bg-gray-100 rounded w-full mt-2"></div>
          <div className="h-3.5 bg-gray-100 rounded w-2/3"></div>
        </div>
      ) : response ? (
        <div id="answer_content_wrapper" className="flex flex-col">
          {/* Question subtitle */}
          <div className="mb-4 bg-gray-50/50 rounded-lg p-3 border border-gray-100">
            <span className="text-[11px] uppercase tracking-wider text-gray-400 font-medium block">Question asked:</span>
            <span className="text-sm font-medium text-gray-800">{response.question}</span>
          </div>

          <div id="rendered_answer_body" className="prose max-w-none">
            {renderFormattedAnswer(response.answer)}
          </div>

          {/* Sources expander */}
          <div id="sources_panel" className="mt-6 border-t border-gray-100 pt-4">
            <button
              id="toggle_sources_btn"
              onClick={() => setShowSources(!showSources)}
              className="flex items-center justify-between w-full text-xs text-gray-500 hover:text-gray-900 group font-medium"
            >
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-800" />
                Inspect Vector Retrieval Context ({response.retrievedChunks.length} blocks)
              </span>
              {showSources ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showSources && (
              <div id="sources_list" className="mt-3 flex flex-col gap-2.5 animate-fadeIn">
                {response.retrievedChunks.map((chunk, index) => {
                  const isActive = activeSourceId === chunk.id;
                  const relevancePercent = chunk.score ? Math.round(chunk.score * 100) : null;
                  
                  return (
                    <div
                      key={chunk.id}
                      id={chunk.id}
                      className={`text-xs p-3.5 rounded-lg border transition-all ${
                        isActive
                          ? "border-indigo-200 bg-indigo-50/35 ring-1 ring-indigo-100/50"
                          : "border-gray-100 bg-gray-50/30 hover:border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5 font-medium text-gray-500">
                        <span className="flex items-center gap-1 text-gray-700">
                          <Bookmark className="w-3 h-3 text-gray-400" />
                          Source Block #{index + 1} (Page {chunk.pageNumber})
                        </span>
                        {relevancePercent && (
                          <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-mono text-gray-500">
                            Match Relevance: {relevancePercent}%
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 line-clamp-4 hover:line-clamp-none leading-relaxed select-text font-serif">
                        {chunk.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div id="no_answer_fallback" className="text-center py-8 text-gray-400">
          <p className="text-sm">No query active</p>
          <p className="text-xs mt-1">Upload a PDF and raise a question starting document intelligence analysis.</p>
        </div>
      )}
    </div>
  );
}
