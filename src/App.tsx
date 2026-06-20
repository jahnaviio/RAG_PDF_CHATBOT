import { useState, useEffect } from "react";
import { FileText, Database, ShieldCheck, HelpCircle, HardDriveDownload, Network, Zap } from "lucide-react";
import UploadSection from "./components/UploadSection";
import QuestionBox from "./components/QuestionBox";
import AnswerDisplay from "./components/AnswerDisplay";
import MyDocuments from "./components/MyDocuments";
import { DocumentMetadata, QueryResponse } from "./types";

export default function App() {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [activeDoc, setActiveDoc] = useState<DocumentMetadata | null>(null);
  const [queryResponse, setQueryResponse] = useState<QueryResponse | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing memory indexes on mount
  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const resp = await fetch("/api/documents");
      if (resp.ok) {
        const data = await resp.json();
        setDocuments(data);
        // Default to the most recently uploaded document if none is active
        if (data.length > 0 && !activeDoc) {
          setActiveDoc(data[data.length - 1]);
        }
      }
    } catch (err) {
      console.error("Failed to load documents list from database:", err);
    }
  };

  const handleUploadSuccess = (metadata: DocumentMetadata) => {
    setActiveDoc(metadata);
    setQueryResponse(null);
    fetchDocuments();
  };

  const handleResetDocument = () => {
    setActiveDoc(null);
    setQueryResponse(null);
  };

  const handleSelectDoc = (doc: DocumentMetadata) => {
    setActiveDoc(doc);
    setQueryResponse(null);
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      const response = await fetch(`/api/documents/${docId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        if (activeDoc?.id === docId) {
          setActiveDoc(null);
          setQueryResponse(null);
        }
        fetchDocuments();
      }
    } catch (err) {
      console.error("Purging document failed:", err);
    }
  };

  const handleAskQuestion = async (question: string) => {
    if (!activeDoc) return;
    setError(null);
    setQueryLoading(true);
    setQueryResponse(null);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: activeDoc.id,
          question: question,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "RAG engine query failed.");
      }

      const result = await response.json();
      setQueryResponse(result);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "An unexpected response generator failure occurred.");
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50/50 pb-16 font-sans antialiased text-gray-800">
      {/* Top Professional Header */}
      <header className="border-b border-gray-100 bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="bg-gray-900 text-white p-1.5 rounded-lg border border-gray-900 shadow-sm shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold tracking-tight text-gray-900">
                  RAG PDF Knowledge Assistant
                </h1>
              </div>
              <p className="mt-1 text-sm text-gray-500 max-w-2xl">
                Upload any PDF and ask questions about its content using AI-powered document intelligence.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs bg-gray-50 text-gray-500 px-3 py-1.5 rounded-lg border border-gray-100 self-start md:self-auto shrink-0 font-mono">
              <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
              <span>Full-Stack RAG Vector Chain Active</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 bg-red-50 text-red-600 text-sm p-4 rounded-xl flex items-start gap-3 border border-red-100 shadow-sm">
            <HelpCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Query Engine Blocked</p>
              <p className="opacity-90">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main Controls Panel (Width 2/3 Desktop) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* 1. PDF Upload Setup */}
            <UploadSection
              onUploadSuccess={handleUploadSuccess}
              onReset={handleResetDocument}
              activeDoc={activeDoc}
            />

            {/* 2. Questions Input box */}
            <QuestionBox
              onAsk={handleAskQuestion}
              disabled={!activeDoc}
              loading={queryLoading}
            />

            {/* 3. Generative Answers display */}
            {(queryResponse || queryLoading) && (
              <AnswerDisplay response={queryResponse} loading={queryLoading} />
            )}
          </div>

          {/* Context Sidebar (Width 1/3 Desktop) */}
          <div className="flex flex-col gap-6">
            {/* RAG Memory Storage document switcher list */}
            <MyDocuments
              documents={documents}
              activeDoc={activeDoc}
              onSelectDoc={handleSelectDoc}
              onDeleteDoc={handleDeleteDoc}
            />

            {/* AI Architecture Overview Details Card */}
            <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col">
              <h2 className="text-sm font-medium uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                <Network className="w-4 h-4" />
                Pipeline Architecture
              </h2>

              <p className="text-xs text-gray-500 leading-relaxed mb-4">
                This client-server bundle implements a professional full-stack Retrieval-Augmented Generation pipeline.
              </p>

              {/* Steps vertical diagrams */}
              <div className="flex flex-col gap-4 font-sans text-xs">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="bg-gray-100 text-gray-900 border border-gray-200 font-bold font-mono p-1 h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                      1
                    </div>
                    <div className="w-0.5 h-full bg-gray-100 mt-1"></div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 flex items-center gap-1">
                      <HardDriveDownload className="w-3.5 h-3.5" />
                      Text Extraction & Split
                    </p>
                    <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">
                      Server reads raw bytes using <code>pdf-parse</code>. Splits text recursively on punctuation boundaries into overlapping blocks (~1000 characters) to optimize retrieval window relevance.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="bg-gray-100 text-gray-900 border border-gray-200 font-bold font-mono p-1 h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                      2
                    </div>
                    <div className="w-0.5 h-full bg-gray-100 mt-1"></div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5" />
                      Embeddings Engine
                    </p>
                    <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">
                      Generates 768-dimension float vector signatures for all text fractions using the <code>gemini-embedding-2-preview</code> model.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="bg-gray-150 text-gray-900 border border-gray-250 font-bold font-mono p-1 h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                      3
                    </div>
                    <div className="w-0.5 h-full bg-gray-100 mt-1"></div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 flex items-center gap-1">
                      <Database className="w-3.5 h-3.5" />
                      In-Memory Vector DB
                    </p>
                    <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">
                      Retains document weight blocks in virtual vector directories to run low-latency Cosine Similarity scans, capturing source relevance.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="bg-gray-900 text-white border border-gray-900 font-bold font-mono p-1 h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                      4
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" />
                      Grounding LLM
                    </p>
                    <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">
                      Pins retrieved context fragments inside system prompts and uses <code>gemini-3.5-flash</code> to ensure strict, hallucination-free generation with page citations.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
