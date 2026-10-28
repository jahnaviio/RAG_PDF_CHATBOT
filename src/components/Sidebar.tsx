import { useRef } from "react";
import { BookOpen, FileText, Layers, LogOut, MessageCircle, Plus, Trash2, X } from "lucide-react";
import type { DocumentMetadata, User } from "../types";

interface SidebarProps {
  documents: DocumentMetadata[];
  activeId: string | null;
  busy: boolean;
  open: boolean;
  user: User;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onFile: (file: File) => void;
  onLogout: () => void;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function Sidebar({ documents, activeId, busy, open, user, onClose, onSelect, onDelete, onFile, onLogout }: SidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const chatItems = [
    { id: "general", label: "General chat", hint: "Ask anything", Icon: MessageCircle, show: true },
    { id: "all", label: "All documents", hint: `Search across ${documents.length} PDFs`, Icon: Layers, show: documents.length >= 2 },
  ].filter((c) => c.show);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-stone-900/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-stone-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-900 text-white">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-stone-900">PDF Chat</p>
            <p className="text-xs text-stone-500">Ask your documents</p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 lg:hidden" aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onFile(f);
                onClose();
              }
              e.target.value = "";
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add PDF
          </button>
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Chats</p>
          <div className="mt-2 space-y-1">
            {chatItems.map(({ id, label, hint, Icon }) => {
              const active = id === activeId;
              return (
                <div
                  key={id}
                  onClick={() => {
                    onSelect(id);
                    onClose();
                  }}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${active ? "bg-stone-100" : "hover:bg-stone-50"}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-indigo-600" : "text-stone-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${active ? "font-semibold text-stone-900" : "text-stone-700"}`}>{label}</p>
                    <p className="text-xs text-stone-400">{hint}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Documents</p>
          <div className="mt-2 space-y-1">
            {documents.length === 0 && <p className="px-2 py-3 text-sm text-stone-400">Nothing here yet. Add a PDF to get started.</p>}
            {documents.map((doc) => {
              const active = doc.id === activeId;
              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    onSelect(doc.id);
                    onClose();
                  }}
                  className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                    active ? "bg-stone-100" : "hover:bg-stone-50"
                  }`}
                >
                  <FileText className={`h-4 w-4 shrink-0 ${active ? "text-indigo-600" : "text-stone-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${active ? "font-semibold text-stone-900" : "text-stone-700"}`}>{doc.name}</p>
                    <p className="text-xs text-stone-400">
                      {doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"} · {formatSize(doc.size)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(doc.id);
                    }}
                    className="rounded-md p-1.5 text-stone-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
                    aria-label={`Remove ${doc.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="flex items-center gap-3 border-t border-stone-100 px-4 py-3">
          {user.picture ? (
            <img src={user.picture} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-stone-800">{user.name}</p>
            <p className="truncate text-xs text-stone-400">{user.email}</p>
          </div>
          <button onClick={onLogout} className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900" aria-label="Log out" title="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
