import React, { useState, useRef } from "react";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { DocumentMetadata } from "../types";

interface UploadSectionProps {
  onUploadSuccess: (metadata: DocumentMetadata) => void;
  onReset: () => void;
  activeDoc: DocumentMetadata | null;
}

export default function UploadSection({ onUploadSuccess, onReset, activeDoc }: UploadSectionProps) {
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stack-safe conversion of bytes to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arrayBuffer = reader.result as ArrayBuffer;
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          resolve(window.btoa(binary));
        } catch (err) {
          reject(new Error("Browser memory limits exceeded while converting PDF. try a smaller PDF."));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndProcessFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndProcessFile(e.target.files[0]);
    }
  };

  const validateAndProcessFile = async (file: File) => {
    setError(null);
    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      setError("Please upload a PDF document only.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) { // 20 MB max limit for stability
      setError("File is too large. Maximum size supported is 20MB.");
      return;
    }

    setLocalFile(file);
    setLoading(true);
    setProgress(15);

    try {
      // Simulate conversion/upload progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 12;
        });
      }, 250);

      const base64Data = await fileToBase64(file);
      setProgress(60);

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64: base64Data,
          fileName: file.name,
          fileSize: file.size,
        }),
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to process PDF.");
      }

      const result = await response.json();
      setTimeout(() => {
        setLoading(false);
        onUploadSuccess(result.metadata);
      }, 500);

    } catch (err: any) {
      console.error(err);
      setError(err?.message || "An unexpected error occurred during document indexing.");
      setLoading(false);
      setLocalFile(null);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div id="upload_section_container" className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
      <h2 id="upload_title" className="text-sm font-medium uppercase tracking-wider text-gray-400 mb-4">
        Document Setup
      </h2>

      {error && (
        <div id="upload_error_banner" className="mb-4 bg-red-50 text-red-600 text-sm p-3 rounded-lg flex items-start gap-2.5 border border-red-100">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {!activeDoc && !loading ? (
        <div
          id="drop_zone"
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={triggerFileInput}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
            dragActive
              ? "border-gray-900 bg-gray-50/50"
              : "border-gray-200 hover:border-gray-400 hover:bg-gray-50/20"
          }`}
        >
          <input
            id="file_input"
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileInput}
          />
          <div className="flex flex-col items-center">
            <div className="p-3 bg-gray-50 rounded-full text-gray-500 mb-3 border border-gray-100">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-gray-900 text-sm font-semibold mb-1">
              Drag and drop your PDF here, or <span className="text-gray-900 underline pointer-events-none">browse</span>
            </p>
            <p className="text-gray-400 text-xs mt-1">
              Supports vector-based PDFs up to 20MB
            </p>
          </div>
        </div>
      ) : loading ? (
        <div id="upload_loading_state" className="border border-gray-100 rounded-xl p-8 bg-gray-50/30 flex flex-col items-center text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-900 mb-3" />
          <p className="text-sm font-medium text-gray-800">
            {progress < 40
              ? "Extracting text structure..."
              : progress < 85
              ? "Mapping chunks and pages..."
              : "Generating semantic AI vector weights..."}
          </p>
          <p className="text-xs text-gray-400 mt-1">This processes offline inside memory indexes</p>
          
          <div className="w-full max-w-xs bg-gray-100 rounded-full h-1.5 mt-4 overflow-hidden">
            <div 
              className="bg-gray-900 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <span className="text-xs font-mono text-gray-400 mt-2">{progress}%</span>
        </div>
      ) : (
        <div id="upload_success_state" className="border border-gray-100 rounded-xl p-5 bg-gray-50/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 text-green-600 rounded-lg border border-green-100">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-gray-900 text-sm font-medium line-clamp-1 max-w-[280px] sm:max-w-[400px]">
                {activeDoc?.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                <span>{(activeDoc!.size / 1024 / 1024).toFixed(2)} MB</span>
                <span>•</span>
                <span>{activeDoc!.chunkCount} source chunks</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-green-600 font-medium text-xs bg-green-50 px-2.5 py-1 rounded-full border border-green-100 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Processed</span>
            </div>
            <button
              id="reset_document_btn"
              onClick={onReset}
              className="text-xs text-gray-500 hover:text-gray-900 px-2.5 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              Change File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
