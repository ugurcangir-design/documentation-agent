import { useState, useEffect } from "react";
import { discovery, jobs } from "../lib/api";
import ProgressView from "../components/ProgressView";
import type { StoredScreen } from "../types";

interface DiscoveryPageProps {
  onJobStarted: (jobId: string) => void;
  deepAnalysis: boolean;
}

const STEPS = [
  { n: 1, label: "URL Yapılandır" },
  { n: 2, label: "Ekranları Keşfet" },
  { n: 3, label: "Ekran Seç" },
  { n: 4, label: "Döküman Oluştur" },
];

export default function DiscoveryPage({ onJobStarted, deepAnalysis }: DiscoveryPageProps) {
  const [screens, setScreens] = useState<StoredScreen[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraUrl, setExtraUrl] = useState("");
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [docJobLoading, setDocJobLoading] = useState(false);
  const [appUrl, setAppUrl] = useState("");
  const [contextOpen, setContextOpen] = useState(true);
  const [keywords, setKeywords] = useState("");
  const [confluencePages, setConfluencePages] = useState("");

  const activeStep =
    docJobLoading ? 4
    : screens.length > 0 && selected.size > 0 ? 3
    : screens.length > 0 ? 3
    : discovering ? 2
    : appUrl ? 2
    : 1;

  useEffect(() => {
    discovery.getScreens().then(setScreens).catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { values: { APP_BASE_URL?: string } }) => setAppUrl(d.values?.APP_BASE_URL ?? ""))
      .catch(() => {});
  }, []);

  async function startDiscovery() {
    setDiscovering(true);
    setScreens([]);
    setSelected(new Set());
    try {
      const { jobId } = await discovery.start(extraUrls);
      setDiscoveryJobId(jobId);
    } catch (err) {
      alert((err as Error).message);
      setDiscovering(false);
    }
  }

  function handleDiscoveryComplete() {
    setDiscovering(false);
    setDiscoveryJobId(null);
    discovery.getScreens().then((s) => {
      setScreens(s);
      setSelected(new Set(s.map((sc) => sc.path)));
    });
  }

  function toggleScreen(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  function addExtraUrl() {
    const url = extraUrl.trim();
    if (!url || extraUrls.includes(url)) return;
    setExtraUrls((prev) => [...prev, url]);
    setExtraUrl("");
  }

  async function startDocumentation() {
    if (selected.size === 0) { alert("En az bir ekran seçin."); return; }
    setDocJobLoading(true);
    try {
      const { jobId } = await jobs.start(Array.from(selected));
      onJobStarted(jobId);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDocJobLoading(false);
    }
  }

  return (
    <div className="p-7 max-w-4xl mx-auto space-y-5">
      {/* Page title */}
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Ekran Keşfi</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">
          Uygulamayı otomatik tara, ekranları seç ve Claude ile döküman oluştur.
        </p>
      </div>

      {/* Pipeline steps */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[13px] font-semibold text-gray-700">İş Akışı</h2>
          <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
            {STEPS.length} ADIM
          </span>
        </div>
        <div className="flex items-center">
          {STEPS.map((step, i) => {
            const isActive = activeStep === step.n;
            const isDone = activeStep > step.n;
            return (
              <div key={step.n} className="flex items-center flex-1 min-w-0">
                <div className={`flex items-center gap-2 flex-1 min-w-0 ${isActive ? "opacity-100" : isDone ? "opacity-70" : "opacity-35"}`}>
                  <div className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                    isActive ? "bg-blue-600 text-white" :
                    isDone ? "bg-green-500 text-white" :
                    "bg-gray-100 text-gray-400"
                  }`}>
                    {isDone ? "✓" : step.n}
                  </div>
                  <span className={`text-[13px] truncate ${isActive ? "text-gray-900 font-medium" : "text-gray-500"}`}>
                    {step.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <svg className="mx-3 text-gray-200 flex-shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 8h8M9 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* URL Config / Start card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase">
              Girdi — STEP 1/{STEPS.length}
            </p>
            <h3 className="text-[14px] font-semibold text-gray-800 mt-0.5">Hedef Uygulama</h3>
          </div>
          {appUrl ? (
            <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
              ✓ yapılandırıldı
            </span>
          ) : (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("navigate", { detail: "settings" }))}
              className="text-[12px] text-blue-600 hover:text-blue-800 underline"
            >
              Ayarları aç →
            </button>
          )}
        </div>

        {appUrl && (
          <div className="mb-4 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
            <span className="text-[13px] text-gray-600 truncate">{appUrl}</span>
          </div>
        )}

        {/* Extra URLs */}
        <div className="mb-4">
          <label className="block text-[12px] font-medium text-gray-600 mb-1.5">
            Ek URL{" "}
            <span className="text-gray-400 font-normal">(opsiyonel)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={extraUrl}
              onChange={(e) => setExtraUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExtraUrl()}
              placeholder="https://uygulama.com/ekran-path"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            />
            <button
              onClick={addExtraUrl}
              className="px-3 py-2 border border-gray-200 text-gray-600 text-[13px] rounded-lg hover:bg-gray-50"
            >
              Ekle
            </button>
          </div>
          {extraUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {extraUrls.map((u) => (
                <span key={u} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[11px] px-2 py-0.5 rounded-full border border-blue-200">
                  {u}
                  <button onClick={() => setExtraUrls((p) => p.filter((x) => x !== u))} className="ml-0.5 hover:text-blue-900">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={startDiscovery}
            disabled={discovering || !appUrl}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-[13px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {discovering && (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {discovering ? "Keşfediliyor..." : "Başlat"}
          </button>
          {deepAnalysis && (
            <button
              onClick={startDiscovery}
              disabled={discovering || !appUrl}
              className="flex items-center gap-2 px-4 py-2 border border-violet-300 text-violet-700 text-[13px] font-medium rounded-lg hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Derin Analizle Başlat
            </button>
          )}
        </div>
      </div>

      {/* Discovery progress */}
      {discovering && discoveryJobId && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase mb-1">
            İlerleme — STEP 2/{STEPS.length}
          </p>
          <h3 className="text-[14px] font-semibold text-gray-800 mb-4">Ekranlar Keşfediliyor</h3>
          <ProgressView
            streamUrl={`/api/discovery/${discoveryJobId}/stream`}
            onComplete={handleDiscoveryComplete}
          />
        </div>
      )}

      {/* Context filter */}
      <div className="bg-white rounded-xl border border-gray-200">
        <button
          onClick={() => setContextOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4"
        >
          <div className="flex items-center gap-2.5">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h12M4 8h8M6 12h4" />
            </svg>
            <span className="text-[14px] font-semibold text-gray-800">Bağlam Filtresi</span>
          </div>
          <div className="flex items-center gap-2">
            {(keywords || confluencePages) && (
              <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                aktif
              </span>
            )}
            <svg className={`text-gray-400 transition-transform ${contextOpen ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </button>

        {contextOpen && (
          <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-500 tracking-widest uppercase mb-1">
                Anahtar Kelimeler
              </p>
              <p className="text-[12px] text-gray-400 mb-2">
                Confluence sayfalarında ve Jira task'larında bu kelimeleri ara
              </p>
              <input
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="ör: ticket management, kullanıcı yönetimi"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
              />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500 tracking-widest uppercase mb-1">
                Confluence Sayfa Adları
              </p>
              <p className="text-[12px] text-gray-400 mb-2">
                Boş bırakılırsa içerik bazlı aranır
              </p>
              <input
                type="text"
                value={confluencePages}
                onChange={(e) => setConfluencePages(e.target.value)}
                placeholder="ticket management"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button className="px-4 py-1.5 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800">
                Kaydet
              </button>
              <button
                onClick={() => { setKeywords(""); setConfluencePages(""); }}
                className="px-4 py-1.5 border border-gray-200 text-gray-600 text-[13px] rounded-lg hover:bg-gray-50"
              >
                Temizle
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Screen grid */}
      {screens.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase mb-0.5">
                Seçim — STEP 3/{STEPS.length}
              </p>
              <h3 className="text-[14px] font-semibold text-gray-800">
                Keşfedilen Ekranlar
              </h3>
              <p className="text-[12px] text-gray-400 mt-0.5">{screens.length} ekran bulundu</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => selected.size === screens.length
                  ? setSelected(new Set())
                  : setSelected(new Set(screens.map((s) => s.path)))}
                className="text-[12px] text-blue-600 hover:text-blue-800"
              >
                {selected.size === screens.length ? "Seçimi Kaldır" : "Tümünü Seç"}
              </button>
              <span className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {selected.size}/{screens.length}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {screens.map((screen) => (
              <label
                key={screen.path}
                className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  selected.has(screen.path)
                    ? "border-blue-300 bg-blue-50/50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(screen.path)}
                  onChange={() => toggleScreen(screen.path)}
                  className="mt-1 flex-shrink-0 accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <img
                      src={`/screenshots/${screen.screenshotPath.split("/").pop()}`}
                      alt={screen.title}
                      className="w-20 h-12 object-cover rounded border border-gray-200 flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-800 truncate">
                        {screen.title || screen.path}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{screen.path}</p>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded mt-1 inline-block">
                        depth {screen.depth}
                      </span>
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <p className="text-[13px] text-gray-500">
              {selected.size === 0
                ? "Döküman oluşturmak için en az bir ekran seçin"
                : `${selected.size} ekran için Claude${deepAnalysis ? " (Derin Analiz)" : ""} ile döküman oluşturulacak`}
            </p>
            <button
              onClick={startDocumentation}
              disabled={selected.size === 0 || docJobLoading}
              className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-[13px] font-medium rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {docJobLoading && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {docJobLoading ? "Başlatılıyor..." : "Döküman Oluştur →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
