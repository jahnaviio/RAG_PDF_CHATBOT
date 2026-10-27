import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, Menu, X } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Dropzone from "./components/Dropzone";
import IndexingCard from "./components/IndexingCard";
import MessageBubble, { TypingBubble } from "./components/MessageBubble";
import Composer from "./components/Composer";
import { askQuestion, indexDocument } from "./lib/rag";
import type { ChatMessage, DocumentIndex, IndexProgress } from "./types";

const SUGGESTIONS = [
  "Summarize this document in a few bullet points.",
  "What are the key takeaways?",
  "List any important dates, numbers, or names.",
  "What conclusions or recommendations does it make?",
];

const uid = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  // Everything lives in the browser: the vector index is never stored on the server.
  const [indexes, setIndexes] = useState<Record<string, DocumentIndex>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const documents = Object.values(indexes).map((i) => i.metadata);
  const active = activeId ? indexes[activeId] : null;
  const messages = activeId ? chats[activeId] ?? [] : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking, progress]);

  const handleFile = async (file: File) => {
    if (progress) return;
    setUploadError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setUploadError("Please choose a PDF file.");
      return;
    }
    setProgress({ fileName: file.name, stage: "reading", percent: 0, message: "Starting…" });
    try {
      const index = await indexDocument(file, setProgress);
      setIndexes((prev) => ({ ...prev, [index.metadata.id]: index }));
      setActiveId(index.metadata.id);
    } catch (err: any) {
      console.error(err);
      setUploadError(err?.message || "Something went wrong while processing the PDF.");
    } finally {
      setProgress(null);
    }
  };

  const handleDelete = (id: string) => {
    const remaining = documents.filter((d) => d.id !== id);
    setIndexes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setChats((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
  };

  const push = (docId: string, msg: ChatMessage) => setChats((prev) => ({ ...prev, [docId]: [...(prev[docId] ?? []), msg] }));

  const handleAsk = async (question: string) => {
    if (!active || thinking) return;
    const docId = active.metadata.id;
    push(docId, { id: uid(), role: "user", content: question });
    setThinking(true);
    try {
      const { answer, sources } = await askQuestion(question, active);
      push(docId, { id: uid(), role: "assistant", content: answer, sources });
    } catch (err: any) {
      console.error(err);
      push(docId, { id: uid(), role: "assistant", content: err?.message || "Could not get an answer. Please try again.", error: true });
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex h-full bg-[#fafaf9] font-sans">
      <Sidebar
        documents={documents}
        activeId={activeId}
        busy={Boolean(progress)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={setActiveId}
        onDelete={handleDelete}
        onFile={handleFile}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 lg:hidden" aria-label="Open sidebar">
            <Menu className="h-5 w-5" />
          </button>
          {active ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <FileText className="h-4 w-4 shrink-0 text-indigo-600" />
              <h1 className="truncate text-sm font-semibold text-stone-900">{active.metadata.name}</h1>
              <span className="hidden shrink-0 text-xs text-stone-400 sm:inline">
                {active.metadata.pageCount} pages · {active.metadata.chunkCount} chunks indexed
              </span>
            </div>
          ) : (
            <h1 className="text-sm font-semibold text-stone-900">RAG PDF Knowledge Assistant</h1>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
            {uploadError && (
              <div className="rise flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="flex-1">{uploadError}</p>
                <button onClick={() => setUploadError(null)} aria-label="Dismiss" className="text-red-400 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {progress && <IndexingCard progress={progress} />}

            {!active && !progress && (
              <div className="rise my-auto flex flex-col items-center text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Chat with any PDF</h2>
                <p className="mb-8 mt-2 max-w-md text-stone-500">
                  Upload a document and ask questions in plain English. Every answer is grounded in your file and shows the pages it came from.
                </p>
                <Dropzone onFile={handleFile} />
                <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
                  {[
                    ["1. Upload", "Your PDF is read in your browser and split into small chunks."],
                    ["2. Index", "Gemini turns each chunk into a vector so meaning can be searched."],
                    ["3. Ask", "The best matching chunks are used to write a cited answer."],
                  ].map(([t, d]) => (
                    <div key={t} className="rounded-xl border border-stone-200 bg-white p-4">
                      <p className="text-sm font-semibold text-stone-900">{t}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-500">{d}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {active && messages.length === 0 && !progress && (
              <div className="rise my-auto text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <FileText className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-semibold text-stone-900">Your document is ready</h2>
                <p className="mb-6 mt-1.5 text-sm text-stone-500">Ask anything about it, or start with one of these.</p>
                <div className="mx-auto grid max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleAsk(s)}
                      className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm text-stone-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {thinking && <TypingBubble />}
            <div ref={bottomRef} />
          </div>
        </main>

        <Composer
          disabled={!active}
          busy={thinking}
          placeholder={active ? "Ask a question about your PDF…" : "Upload a PDF to start asking questions"}
          onSend={handleAsk}
        />
      </div>
    </div>
  );
}
