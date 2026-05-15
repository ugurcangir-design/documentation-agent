import { useState, useEffect } from "react";
import { discovery, jobs } from "../lib/api";
import ProgressView from "../components/ProgressView";
import type { StoredScreen } from "../types";

interface DiscoveryPageProps {
  onJobStarted: (jobId: string) => void;
}

export default function DiscoveryPage({ onJobStarted }: DiscoveryPageProps) {
  const [screens, setScreens] = useState<StoredScreen[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraUrl, setExtraUrl] = useState("");
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [docJobLoading, setDocJobLoading] = useState(false);
  const [appUrl, setAppUrl] = useState<string>("");

  useEffect(() => {
    discovery.getScreens().then(setScreens).catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { values: { APP_BASE_URL?: string } }) => {
        setAppUrl(d.values?.APP_BASE_URL ?? "");
      })
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
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === screens.length) setSelected(new Set());
    else setSelected(new Set(screens.map((s) => s.path)));
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

  const isConfigured = !!appUrl;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Ekran Keşfi</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Uygulamayı otomatik tarayın, ekranları seçin ve döküman oluşturun.
        </p>
      </div>

      {/* Config status banner */}
      {!isConfigured && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-amber-500 text-lg mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-medium text-amber-800">Yapılandırma gerekli</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Keşif başlatmadan önce{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent("navigate", { detail: "settings" })); }}
                className="underline font-medium">Ayarlar</a>{" "}
              sayfasından uygulama URL ve API anahtarlarını girin.
            </p>
          </div>
        </div>
      )}

      {/* Config + Start card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Keşif Başlat</h2>
            {isConfigured && (
              <p className="text-xs text-gray-400 mt-0.5">
                Hedef:{" "}
                <span className="text-gray-600 font-medium">{appUrl}</span>
              </p>
            )}
          </div>
          {isConfigured && (
            <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
              ✓ Bağlantı yapılandırıldı
            </span>
          )}
        </div>

        {/* Extra URLs */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            Ek URL Ekle{" "}
            <span className="text-gray-400 font-normal">(opsiyonel — otomatik keşfe dahil edilir)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={extraUrl}
              onChange={(e) => setExtraUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExtraUrl()}
              placeholder="https://uygulama.com/ekran-path"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addExtraUrl}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200"
            >
              Ekle
            </button>
          </div>
          {extraUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {extraUrls.map((u) => (
                <span key={u} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full">
                  {u}
                  <button onClick={() => setExtraUrls((p) => p.filter((x) => x !== u))} className="hover:text-blue-900 ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={startDiscovery}
          disabled={discovering || !isConfigured}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {discovering ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Keşfediliyor...
            </>
          ) : (
            "Ekranları Keşfet"
          )}
        </button>
      </div>

      {/* Progress */}
      {discovering && discoveryJobId && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Keşif İlerlemesi</h2>
          <ProgressView
            streamUrl={`/api/discovery/${discoveryJobId}/stream`}
            onComplete={handleDiscoveryComplete}
          />
        </div>
      )}

      {/* Screen grid */}
      {screens.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                Keşfedilen Ekranlar
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{screens.length} ekran bulundu</p>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={toggleAll} className="text-xs text-blue-600 hover:text-blue-800">
                {selected.size === screens.length ? "Seçimi Kaldır" : "Tümünü Seç"}
              </button>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                {selected.size} / {screens.length} seçili
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6">
            {screens.map((screen) => (
              <label
                key={screen.path}
                className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  selected.has(screen.path)
                    ? "border-blue-400 bg-blue-50/50 shadow-sm"
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
                  <div className="flex items-start gap-2.5">
                    <img
                      src={`/screenshots/${screen.screenshotPath.split("/").pop()}`}
                      alt={screen.title}
                      className="w-20 h-12 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {screen.title || screen.path}
                      </p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{screen.path}</p>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded mt-1 inline-block">
                        Derinlik {screen.depth}
                      </span>
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              {selected.size === 0
                ? "Döküman oluşturmak için ekran seçin"
                : `${selected.size} ekran için Claude ile döküman oluşturulacak`}
            </p>
            <button
              onClick={startDocumentation}
              disabled={selected.size === 0 || docJobLoading}
              className="px-6 py-2.5 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {docJobLoading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Başlatılıyor...
                </>
              ) : (
                "Döküman Oluştur →"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
