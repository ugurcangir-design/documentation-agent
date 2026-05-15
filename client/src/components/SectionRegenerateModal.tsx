import { useState, useEffect } from "react";
import { sections as sectionsApi } from "../lib/api";

interface Props {
  documentId: string;
  target: "userManual" | "technicalDoc";
  onClose: () => void;
  onDone: () => void;
}

const SUGGESTIONS = [
  "Daha kısa olsun, en önemli noktaları vurgula",
  "Daha detaylı yaz, her adımı açıkla",
  "Daha sade dil kullan, teknik jargondan kaçın",
  "Tablo formatında yaz",
  "Madde işaretli liste olarak yeniden düzenle",
  "Örneklerle zenginleştir",
];

export default function SectionRegenerateModal({ documentId, target, onClose, onDone }: Props) {
  const [sections, setSections] = useState<Array<{ heading: string; level: number }>>([]);
  const [selectedHeading, setSelectedHeading] = useState<string>("");
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sectionsApi.list(documentId, target).then((data) => {
      setSections(data);
      setSelectedHeading(data[0]?.heading ?? "");
    });
  }, [documentId, target]);

  async function submit() {
    if (!selectedHeading || !instruction.trim()) return;
    setLoading(true); setError(null);
    try {
      await sectionsApi.regenerate(documentId, {
        sectionHeading: selectedHeading,
        instruction,
        target,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Bölüm Yeniden Üret</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {target === "userManual" ? "Kullanıcı Kılavuzu" : "Teknik Döküman"} içinde bir bölümü Claude'a yeniden yazdır
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
              Hangi bölümü?
            </label>
            <select
              value={selectedHeading}
              onChange={(e) => setSelectedHeading(e.target.value)}
              disabled={sections.length === 0}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {sections.length === 0 && <option>Bölüm bulunamadı</option>}
              {sections.map((s) => (
                <option key={s.heading} value={s.heading}>
                  {"  ".repeat(s.level - 2)}{s.heading}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
              Ne istiyorsun?
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              placeholder="Örn: 'Bu bölümü daha kısa yap, en önemli 3 noktayı vurgula'"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />

            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInstruction(s)}
                  className="text-[11px] bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[11px] px-3 py-2 rounded-lg">
            Sadece seçilen bölüm yeniden yazılır. Mevcut hali versiyon geçmişine alınır.
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[13px] text-gray-600 hover:text-gray-900"
          >
            İptal
          </button>
          <button
            onClick={submit}
            disabled={loading || !selectedHeading || !instruction.trim()}
            className="flex items-center gap-2 px-4 py-1.5 bg-violet-600 text-white text-[13px] font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50"
          >
            {loading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? "Üretiliyor..." : "Yeniden Üret"}
          </button>
        </div>
      </div>
    </div>
  );
}
