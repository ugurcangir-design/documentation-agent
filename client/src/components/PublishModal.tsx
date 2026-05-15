import { useState, useEffect } from "react";
import { confluence } from "../lib/api";
import type { ConfluencePage, PublishMode } from "../types";

interface PublishModalProps {
  documentIds: string[];
  onClose: () => void;
  onPublished: () => void;
}

export default function PublishModal({
  documentIds,
  onClose,
  onPublished,
}: PublishModalProps) {
  const [mode, setMode] = useState<PublishMode>("new");
  const [title, setTitle] = useState("Uygulama Dökümanları");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<ConfluencePage[]>([]);
  const [selectedPage, setSelectedPage] =
    useState<ConfluencePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setPages([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        const results = await confluence.searchPages(query);
        setPages(results);
      } catch {
        setPages([]);
      }
    }, 400);

    return () => clearTimeout(t);
  }, [query]);

  async function handlePublish() {
    setLoading(true);
    setError(null);

    try {
      await confluence.publish({
        documentIds,
        mode,
        ...(selectedPage?.id ? { parentPageId: selectedPage.id } : {}),
        title,
      });

      onPublished();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const modeOptions: {
    value: PublishMode;
    label: string;
    description: string;
  }[] = [
    {
      value: "new",
      label: "Yeni / Güncelle",
      description:
        "Sayfa yoksa oluştur, varsa içeriğini değiştir.",
    },
    {
      value: "append",
      label: "Mevcut Sayfaya Ekle",
      description:
        "Seçilen sayfanın sonuna yeni içerik ekle.",
    },
    {
      value: "child",
      label: "Alt Sayfa Olarak",
      description:
        "Seçilen sayfanın altına yeni bir child page oluştur.",
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Confluence'a Yayınla
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Döküman Başlığı
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Publish mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Yükleme Seçeneği
            </label>
            <div className="space-y-2">
              {modeOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    mode === opt.value
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={opt.value}
                    checked={mode === opt.value}
                    onChange={() => setMode(opt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {opt.label}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {opt.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Page search (for append/child) */}
          {(mode === "append" || mode === "child") && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {mode === "append"
                  ? "Hangi sayfaya eklensin?"
                  : "Hangi sayfanın altına?"}
              </label>
              <input
                type="text"
                placeholder="Confluence sayfa adı ara..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {pages.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
                  {pages.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedPage(p);
                        setQuery(p.title);
                        setPages([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
              {selectedPage && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ Seçildi: {selectedPage.title}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handlePublish}
            disabled={loading}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {loading ? "Yayınlanıyor..." : "Yayınla"}
          </button>
        </div>
      </div>
    </div>
  );
}
