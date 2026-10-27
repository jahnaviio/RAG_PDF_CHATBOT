import { useRef, useState } from "react";
import { Upload } from "lucide-react";

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function Dropzone({ onFile, disabled }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (file?: File) => {
    if (file && !disabled) onFile(file);
    if (inputRef.current) inputRef.current.value = ""; // allow picking the same file again
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files?.[0]);
      }}
      className={`group flex w-full cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        dragging ? "border-indigo-500 bg-indigo-50" : "border-stone-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600">
        <Upload className="h-5 w-5" />
      </div>
      <p className="text-base font-semibold text-stone-900">
        Drop your PDF here, or <span className="text-indigo-600 underline underline-offset-2">browse</span>
      </p>
      <p className="mt-1.5 text-sm text-stone-500">Text-based PDFs up to 25MB. Your file is read in your browser.</p>
    </div>
  );
}
