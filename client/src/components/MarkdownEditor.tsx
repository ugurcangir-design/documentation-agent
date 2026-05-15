import { useState } from "react";
import ReactMarkdown from "react-markdown";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export default function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"preview" | "edit">("preview");

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-gray-200 px-3 py-1.5 bg-white">
        <button
          onClick={() => setMode("preview")}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            mode === "preview"
              ? "bg-gray-100 text-gray-900 font-medium"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Önizleme
        </button>
        {!readOnly && (
          <button
            onClick={() => setMode("edit")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              mode === "edit"
                ? "bg-gray-100 text-gray-900 font-medium"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Düzenle
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {mode === "preview" ? (
          <div className="markdown-preview px-5 py-4">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="w-full h-full min-h-[400px] p-4 font-mono text-sm text-gray-800 bg-white resize-none focus:outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Markdown içerik..."
          />
        )}
      </div>
    </div>
  );
}
