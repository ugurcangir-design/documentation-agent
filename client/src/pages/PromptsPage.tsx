import { useState, useEffect } from "react";

interface PromptConfig {
  id: string;
  name: string;
  description: string;
  role?: string;
  outputStructure?: string;
  instructions?: string;
  rules?: string[];
  language?: string;
  maxTokens?: number;
}

type AllPrompts = Record<string, PromptConfig>;

const PROMPT_DESCRIPTIONS: Record<string, string> = {
  userManual: "Son kullanıcıya yönelik kılavuz bölümü. Teknik olmayan, sade dil.",
  screenAnalysis: "Ekran görüntüsünü analiz ederek JSON çıktısı üretir. Doğrudan değiştirme.",
};

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<AllPrompts>({});
  const [activeKey, setActiveKey] = useState<string>("userManual");
  const [editing, setEditing] = useState<PromptConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data: AllPrompts) => {
        setPrompts(data);
        const first = Object.keys(data)[0];
        if (first) {
          setActiveKey(first);
          setEditing({ ...data[first]! });
        }
      })
      .catch(() => {});
  }, []);

  function selectPrompt(key: string) {
    setActiveKey(key);
    setEditing(prompts[key] ? { ...prompts[key]! } : null);
    setSaved(false);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      await fetch(`/api/prompts/${activeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-DocAgent": "1" },
        body: JSON.stringify(editing),
      });
      setPrompts((prev) => ({ ...prev, [activeKey]: editing }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  function updateField(field: keyof PromptConfig, value: unknown) {
    setEditing((prev) => prev ? { ...prev, [field]: value } : prev);
    setSaved(false);
  }

  function updateRule(idx: number, value: string) {
    setEditing((prev) => {
      if (!prev) return prev;
      const rules = [...(prev.rules ?? [])];
      rules[idx] = value;
      return { ...prev, rules };
    });
    setSaved(false);
  }

  function addRule() {
    setEditing((prev) => {
      if (!prev) return prev;
      return { ...prev, rules: [...(prev.rules ?? []), ""] };
    });
  }

  function removeRule(idx: number) {
    setEditing((prev) => {
      if (!prev) return prev;
      return { ...prev, rules: (prev.rules ?? []).filter((_, i) => i !== idx) };
    });
  }

  const PROMPT_KEYS = Object.keys(prompts);

  return (
    <div className="flex h-[calc(100vh-2.75rem)] overflow-hidden">
      {/* Left: prompt selector */}
      <div className="w-64 border-r border-gray-200 bg-white flex-shrink-0 p-4 space-y-1 overflow-y-auto">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-3">
          Agent Promptları
        </p>
        {PROMPT_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => selectPrompt(key)}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
              activeKey === key
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <p className="text-[13px] font-medium">{prompts[key]?.name ?? key}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">
              {PROMPT_DESCRIPTIONS[key] ?? prompts[key]?.description}
            </p>
          </button>
        ))}

        <div className="pt-4 border-t border-gray-100 mt-4">
          <p className="text-[11px] text-gray-400 px-2">
            Promptlar <code className="bg-gray-100 px-1 rounded">data/prompts/config.json</code> dosyasında saklanır.
          </p>
        </div>
      </div>

      {/* Right: editor */}
      <div className="flex-1 overflow-auto p-7">
        {editing ? (
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-[20px] font-semibold text-gray-900">{editing.name}</h1>
                <p className="text-[13px] text-gray-400 mt-0.5">{editing.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {saved && <span className="text-[12px] text-green-600">✓ Kaydedildi</span>}
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-1.5 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
            </div>

            {/* Role */}
            {editing.role !== undefined && (
              <Field label="Rol / Persona" description="Agent'ın üstlendiği kimlik">
                <textarea
                  value={editing.role}
                  onChange={(e) => updateField("role", e.target.value)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 resize-none"
                />
              </Field>
            )}

            {/* Output structure */}
            {editing.outputStructure !== undefined && (
              <Field label="Çıktı Yapısı / Format" description="Dökümanın bölüm başlıkları ve yapısı. Markdown formatında.">
                <textarea
                  value={editing.outputStructure}
                  onChange={(e) => updateField("outputStructure", e.target.value)}
                  rows={14}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 resize-none font-mono"
                />
              </Field>
            )}

            {/* Instructions (for screen analysis) */}
            {editing.instructions !== undefined && (
              <Field label="Talimatlar" description="Analiz talimatları">
                <textarea
                  value={editing.instructions}
                  onChange={(e) => updateField("instructions", e.target.value)}
                  rows={6}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 resize-none"
                />
              </Field>
            )}

            {/* Rules */}
            {editing.rules !== undefined && (
              <Field label="Kurallar" description="Her satır bir kural. Agent bu kurallara uymak zorundadır.">
                <div className="space-y-2">
                  {(editing.rules ?? []).map((rule, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <span className="text-[11px] text-gray-400 w-5 flex-shrink-0 text-right">{i + 1}.</span>
                      <input
                        value={rule}
                        onChange={(e) => updateRule(i, e.target.value)}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                      />
                      <button onClick={() => removeRule(i)} className="text-gray-300 hover:text-red-400 transition-colors">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addRule}
                    className="text-[12px] text-blue-600 hover:text-blue-800 ml-7"
                  >
                    + Kural ekle
                  </button>
                </div>
              </Field>
            )}

            {/* Settings */}
            <Field label="Ayarlar" description="Teknik parametreler">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-gray-500 mb-1">Dil</label>
                  <select
                    value={editing.language ?? "tr"}
                    onChange={(e) => updateField("language", e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none"
                  >
                    <option value="tr">Türkçe</option>
                    <option value="en">English</option>
                  </select>
                </div>
                {editing.maxTokens !== undefined && (
                  <div>
                    <label className="block text-[12px] text-gray-500 mb-1">Maks Token</label>
                    <input
                      type="number"
                      value={editing.maxTokens}
                      onChange={(e) => updateField("maxTokens", parseInt(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none"
                      min={500}
                      max={8000}
                      step={500}
                    />
                  </div>
                )}
              </div>
            </Field>

            {/* Variable reference */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-[12px] font-semibold text-amber-800 mb-2">Kullanılabilir Değişkenler</p>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-amber-700 font-mono">
                {[
                  ["screenTitle", "Ekran başlığı"],
                  ["screenPath", "URL path"],
                  ["purpose", "Ekranın amacı"],
                  ["targetAudience", "Hedef kullanıcı"],
                  ["uiElements", "UI elementleri listesi"],
                  ["workflows", "İş akışları"],
                  ["brdContext", "BRD bölümleri"],
                  ["apiContext", "API endpoint'leri"],
                ].map(([v, d]) => (
                  <div key={v} className="flex gap-1">
                    <span className="text-amber-900">{`{${v}}`}</span>
                    <span className="text-amber-600">— {d}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-amber-600 mt-2">
                Bu değişkenler kod tarafından otomatik eklenir. Çıktı yapısı içinde kullanabilirsiniz.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p className="text-[13px]">Sol panelden bir prompt seçin</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="mb-3">
        <p className="text-[13px] font-semibold text-gray-800">{label}</p>
        {description && <p className="text-[12px] text-gray-400 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}
