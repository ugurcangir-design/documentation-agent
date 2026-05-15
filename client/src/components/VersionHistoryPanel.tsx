import { useEffect, useState } from "react";

interface Version {
  id: string;
  savedAt: string;
  reason: "edit" | "regenerate" | "publish";
  userManualContent: string;
  technicalDocContent: string;
}

interface Props {
  documentId: string;
  onClose: () => void;
  onRestored: () => void;
}

export default function VersionHistoryPanel({ documentId, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<Version | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/versions`)
      .then((r) => r.json())
      .then((data: Version[]) => {
        const sorted = data.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        setVersions(sorted);
        setSelected(sorted[0] ?? null);
      });
  }, [documentId]);

  async function restore() {
    if (!selected) return;
    if (!confirm("Bu versiyona geri dön? Mevcut içerik geçmişe eklenir.")) return;
    setRestoring(true);
    try {
      await fetch(`/api/documents/${documentId}/restore/${selected.id}`, { method: "POST" });
      onRestored();
    } finally {
      setRestoring(false);
    }
  }

  const reasonLabel = (r: Version["reason"]) =>
    r === "edit" ? "Manuel düzenleme" : r === "regenerate" ? "Yeniden üretim" : "Yayın öncesi";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Versiyon Geçmişi</h2>
            <p className="text-[12px] text-gray-400 mt-0.5">{versions.length} kayıt</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Version list */}
          <div className="w-60 border-r border-gray-200 overflow-y-auto">
            {versions.length === 0 ? (
              <p className="p-4 text-center text-[12px] text-gray-400">Henüz versiyon yok.</p>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    selected?.id === v.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                  }`}
                >
                  <p className="text-[12px] font-medium text-gray-700">
                    {new Date(v.savedAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{reasonLabel(v.reason)}</p>
                </button>
              ))
            )}
          </div>

          {/* Preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <p className="text-[12px] text-gray-500">
                    {new Date(selected.savedAt).toLocaleString("tr-TR")} · {reasonLabel(selected.reason)}
                  </p>
                  <button
                    onClick={restore}
                    disabled={restoring}
                    className="px-3 py-1.5 bg-gray-900 text-white text-[12px] font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    {restoring ? "Geri yükleniyor..." : "Bu Versiyona Dön"}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Kullanıcı Kılavuzu</p>
                    <pre className="text-[12px] text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono">{selected.userManualContent.slice(0, 2000)}{selected.userManualContent.length > 2000 ? "..." : ""}</pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Teknik Döküman</p>
                    <pre className="text-[12px] text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono">{selected.technicalDocContent.slice(0, 2000)}{selected.technicalDocContent.length > 2000 ? "..." : ""}</pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-[13px]">
                Versiyon seçin
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
