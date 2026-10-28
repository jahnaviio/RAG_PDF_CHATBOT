import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Eraser, FileText, GraduationCap, Layers, ListChecks, Menu, MessageCircle, X } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Dropzone from "./components/Dropzone";
import IndexingCard from "./components/IndexingCard";
import MessageBubble, { TypingBubble } from "./components/MessageBubble";
import Composer from "./components/Composer";
import { askQuestion, clearHistory, deleteDocument, indexDocument, listDocuments, loadHistory } from "./lib/rag";
import type { ChatMessage, Chunk, DocumentMetadata, IndexProgress, StudyMode, User } from "./types";

const SUGGESTIONS = [
  "Summarize this document in a few bullet points.",
  "What are the key takeaways?",
  "List any important dates, numbers, or names.",
  "What conclusions or recommendations does it make?",
];

const GENERAL_SUGGESTIONS = [
  "Explain how transformers work, like I'm new to AI.",
  "Help me plan a 4-week study schedule.",
  "Give me tips for an AI engineer interview.",
  "What can you do with my PDFs?",
];

const STUDY_TOOLS: { label: string; text: string; mode: StudyMode; Icon: typeof FileText }[] = [
  { label: "Summarize", text: "Summarize this for my exam.", mode: "summary", Icon: FileText },
  { label: "Quiz me", text: "Generate a 5-question quiz.", mode: "quiz", Icon: ListChecks },
  { label: "Flashcards", text: "Make flashcards for the key concepts.", mode: "flashcards", Icon: Layers },
];

const uid = () => Math.random().toString(36).slice(2, 10);

interface AppProps {
  user: User;
  onLogout: () => void;
}

export default function App({ user, onLogout }: AppProps) {
  // Documents and chats are saved to the user's account (Postgres), so they survive refreshes and new devices.
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); // "general" | "all" | document id | null (landing)
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadedScopes = useRef<Map<string, Promise<void>>>(new Map());

  const active = documents.find((d) => d.id === activeId) ?? null;
  const isDocScope = Boolean(active) || activeId === "all";
  const messages = activeId ? chats[activeId] ?? [] : [];
  const last = messages[messages.length - 1];
  const streaming = Boolean(last?.streaming);

  // ---- initial load: previous documents ------------------------------------
  useEffect(() => {
    let cancelled = false;
    listDocuments()
      .then((docs) => {
        if (cancelled) return;
        setDocuments(docs);
        if (docs.length) setActiveId((cur) => cur ?? docs[0].id);
      })
      .catch((err) => !cancelled && setUploadError(err?.message || "Could not load your documents."));
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- chat history, loaded once per chat ----------------------------------
  const ensureHistory = useCallback((scope: string): Promise<void> => {
    const existing = loadedScopes.current.get(scope);
    if (existing) return existing; // already loaded, or loading right now
    const task = loadHistory(scope)
      .then((history) => {
        setChats((prev) => (prev[scope] !== undefined ? prev : { ...prev, [scope]: history }));
      })
      .catch((err) => {
        loadedScopes.current.delete(scope);
        console.error(err);
      });
    loadedScopes.current.set(scope, task);
    return task;
  }, []);

  useEffect(() => {
    if (activeId) void ensureHistory(activeId);
  }, [activeId, ensureHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
  }, [messages.length, last?.content.length, thinking, progress, streaming]);

  const handleFile = async (file: File) => {
    if (progress) return;
    setUploadError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setUploadError("Please choose a PDF file.");
      return;
    }
    setProgress({ fileName: file.name, stage: "reading", percent: 0, message: "Starting…" });
    try {
      const meta = await indexDocument(file, setProgress);
      loadedScopes.current.set(meta.id, Promise.resolve());
      setChats((prev) => ({ ...prev, [meta.id]: [] }));
      setDocuments((prev) => [meta, ...prev]);
      setActiveId(meta.id);
    } catch (err: any) {
      console.error(err);
      setUploadError(err?.message || "Something went wrong while processing the PDF.");
    } finally {
      setProgress(null);
    }
  };

  const handleDelete = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!window.confirm(`Delete "${doc?.name ?? "this PDF"}" and its chat history?`)) return;
    try {
      await deleteDocument(id);
    } catch (err: any) {
      setUploadError(err?.message || "Could not delete the document.");
      return;
    }
    const remaining = documents.filter((d) => d.id !== id);
    setDocuments(remaining);
    setChats((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    loadedScopes.current.delete(id);
    if (activeId === id || (activeId === "all" && remaining.length < 2)) setActiveId(remaining[0]?.id ?? null);
  };

  const handleClear = async () => {
    if (!activeId || !window.confirm("Clear this conversation?")) return;
    try {
      await clearHistory(activeId);
      setChats((prev) => ({ ...prev, [activeId]: [] }));
    } catch (err: any) {
      setUploadError(err?.message || "Could not clear the chat.");
    }
  };

  const upsert = (scope: string, msg: ChatMessage) =>
    setChats((prev) => {
      const list = prev[scope] ?? [];
      const exists = list.some((m) => m.id === msg.id);
      return { ...prev, [scope]: exists ? list.map((m) => (m.id === msg.id ? msg : m)) : [...list, msg] };
    });

  const handleAsk = async (question: string, mode?: StudyMode) => {
    if (thinking || streaming) return;
    const scope = activeId ?? "general"; // typing on the start page opens a normal chat
    if (!activeId) setActiveId("general");

    setThinking(true);
    await ensureHistory(scope);
    upsert(scope, { id: uid(), role: "user", content: question });

    const botId = uid();
    let text = "";
    let sources: Chunk[] = [];
    let terms: string[] = [];
    const render = (extra: Partial<ChatMessage> = {}) =>
      upsert(scope, { id: botId, role: "assistant", content: text, sources, terms, streaming: true, ...extra });

    try {
      await askQuestion(
        { scope, question, mode },
        {
          onMeta: (m) => {
            sources = m.sources;
            terms = m.terms;
          },
          onDelta: (t) => {
            text += t;
            setThinking(false);
            render();
          },
          onDone: ({ cited }) => render({ streaming: false, cited }),
        }
      );
    } catch (err: any) {
      console.error(err);
      if (text) render({ streaming: false, cited: [] });
      upsert(scope, { id: uid(), role: "assistant", content: err?.message || "Could not get an answer. Please try again.", error: true });
    } finally {
      setThinking(false);
    }
  };

  const title =
    activeId === "general" ? "General chat" : activeId === "all" ? `All documents (${documents.length})` : active?.name ?? "RAG PDF Knowledge Assistant";

  const placeholder = active
    ? "Ask a question about your PDF…"
    : activeId === "all"
      ? "Ask across all your PDFs…"
      : "Ask anything, or add a PDF to chat with it";

  return (
    <div className="flex h-full bg-[#fafaf9] font-sans">
      <Sidebar
        documents={documents}
        activeId={activeId}
        busy={Boolean(progress)}
        open={sidebarOpen}
        user={user}
        onClose={() => setSidebarOpen(false)}
        onSelect={setActiveId}
        onDelete={handleDelete}
        onFile={handleFile}
        onLogout={onLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 lg:hidden" aria-label="Open sidebar">
            <Menu className="h-5 w-5" />
          </button>
          {active ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <FileText className="h-4 w-4 shrink-0 text-indigo-600" />
              <h1 className="truncate text-sm font-semibold text-stone-900">{active.name}</h1>
              <span className="hidden shrink-0 text-xs text-stone-400 sm:inline">
                {active.pageCount} pages · {active.chunkCount} chunks indexed
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">
              {activeId === "general" && <MessageCircle className="h-4 w-4 shrink-0 text-indigo-600" />}
              {activeId === "all" && <Layers className="h-4 w-4 shrink-0 text-indigo-600" />}
              <h1 className="truncate text-sm font-semibold text-stone-900">{title}</h1>
            </div>
          )}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear chat</span>
            </button>
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

            {!activeId && !progress && (
              <div className="rise my-auto flex flex-col items-center text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Chat with any PDF</h2>
                <p className="mb-8 mt-2 max-w-md text-stone-500">
                  Upload a document and ask questions in plain English. Every answer is grounded in your file and shows the pages it came from. Or just say hi below.
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

            {activeId === "general" && messages.length === 0 && !progress && (
              <div className="rise my-auto text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <MessageCircle className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-semibold text-stone-900">How can I help?</h2>
                <p className="mb-6 mt-1.5 text-sm text-stone-500">Ask me anything, or add a PDF from the sidebar to chat with it.</p>
                <div className="mx-auto grid max-w-xl gap-2 sm:grid-cols-2">
                  {GENERAL_SUGGESTIONS.map((s) => (
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

            {isDocScope && messages.length === 0 && !progress && (
              <div className="rise my-auto text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <FileText className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-semibold text-stone-900">{active ? "Your document is ready" : "Your documents are ready"}</h2>
                <p className="mb-6 mt-1.5 text-sm text-stone-500">Ask anything about {active ? "it" : "them"}, or start with one of these.</p>
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

        {isDocScope && (
          <div className="bg-[#fafaf9]/90 px-4 pt-2 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-400">
                <GraduationCap className="h-3.5 w-3.5" />
                Study tools
              </span>
              {STUDY_TOOLS.map(({ label, text, mode, Icon }) => (
                <button
                  key={label}
                  onClick={() => handleAsk(text, mode)}
                  disabled={thinking || streaming}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Composer disabled={false} busy={thinking || streaming} placeholder={placeholder} onSend={(t) => handleAsk(t)} />
      </div>
    </div>
  );
}
