import { FileSpreadsheet, Trash2, CheckCircle } from "lucide-react";
import { DocumentMetadata } from "../types";

interface MyDocumentsProps {
  documents: DocumentMetadata[];
  activeDoc: DocumentMetadata | null;
  onSelectDoc: (doc: DocumentMetadata) => void;
  onDeleteDoc: (docId: string) => void;
}

export default function MyDocuments({ documents, activeDoc, onSelectDoc, onDeleteDoc }: MyDocumentsProps) {
  if (documents.length === 0) {
    return (
      <div id="no_documents" className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm text-center">
        <p className="text-xs text-gray-400">No active files stored in system RAG memory yet.</p>
      </div>
    );
  }

  return (
    <div id="documents_list_box" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      <h2 id="documents_list_header" className="text-sm font-medium uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
        Active RAG Memory Storage ({documents.length})
      </h2>
      
      <div className="flex flex-col gap-3">
        {documents.map((doc) => {
          const isActive = activeDoc?.id === doc.id;
          return (
            <div
              key={doc.id}
              id={`doc_entry_${doc.id}`}
              onClick={() => onSelectDoc(doc)}
              className={`p-3.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between group ${
                isActive
                  ? "border-gray-900 bg-gray-50/50"
                  : "border-gray-100 bg-white hover:border-gray-300 hover:bg-gray-50/10"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg border ${
                    isActive 
                      ? "bg-gray-900 text-white border-gray-900" 
                      : "bg-gray-50 text-gray-600 border-gray-100"
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4 shrink-0" />
                </div>
                <div className="min-w-0 pr-2">
                  <p className={`text-xs font-semibold truncate max-w-[140px] sm:max-w-xs ${isActive ? 'text-gray-950' : 'text-gray-800'}`}>
                    {doc.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400 font-mono">
                    <span>{(doc.size / 1024 / 1024).toFixed(2)} MB</span>
                    <span>•</span>
                    <span>{doc.chunkCount} chunks</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isActive && (
                  <span className="flex items-center gap-1 text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full border border-green-100 font-medium shrink-0">
                    <CheckCircle className="w-2.5 h-2.5" />
                    Active
                  </span>
                )}
                <button
                  id={`delete_doc_${doc.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDoc(doc.id);
                  }}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded border border-transparent hover:border-red-100 transition-all cursor-pointer md:opacity-0 md:group-hover:opacity-100"
                  title="Purge from RAG memory"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
