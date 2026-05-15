import { useState, useEffect } from "react";
import { discovery, jobs } from "../lib/api";
import ProgressView from "../components/ProgressView";
import type { StoredScreen } from "../types";

interface DiscoveryPageProps {
  onJobStarted: (jobId: string) => void;
}

export default function DiscoveryPage({
  onJobStarted,
}: DiscoveryPageProps) {
  const [screens, setScreens] = useState<StoredScreen[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraUrl, setExtraUrl] = useState("");
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [docJobLoading, setDocJobLoading] = useState(false);

  useEffect(() => {
    discovery.getScreens().then(setScreens).catch(() => {});
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
      // Auto-select all
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
    if (selected.size === screens.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(screens.map((s) => s.path)));
    }
  }

  function addExtraUrl() {
    const url = extraUrl.trim();
    if (!url || extraUrls.includes(url)) return;
    setExtraUrls((prev) => [...prev, url]);
    setExtraUrl("");
  }

  async function startDocumentation() {
    if (selected.size === 0) {
      alert("En az bir ekran seçin.");
      return;
    }
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
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Ekran Keşfi
        </h1>
        <p className="text-gray-500 mt-1">
          Uygulamayı otomatik tarayın veya URL ekleyin, ardından hangi ekranların dökümanını oluşturmak istediğinizi seçin.
        </p>
      </div>

      {/* Discovery config */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Keşif Ayarları
        </h2>

        {/* Extra URLs */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Manuel URL Ekle (opsiyonel)
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={extraUrl}
              onChange={(e) => setExtraUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExtraUrl()}
              placeholder="https://uygulama.com/ekran-path"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addExtraUrl}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
            >
              Ekle
            </button>
          </div>
          {extraUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {extraUrls.map((u) => (
                <span
                  key={u}
                  className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full"
                >
                  {u}
                  <button
                    onClick={() =>
                      setExtraUrls((prev) =>
                        prev.filter((x) => x !== u)
                      )
                    }
                    className="hover:text-blue-900"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={startDiscovery}
          disabled={discovering}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {discovering ? "Keşfediliyor..." : "🔍 Ekranları Keşfet"}
        </button>
      </div>

      {/* Discovery progress */}
      {discovering && discoveryJobId && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">
            Keşif İlerlemesi
          </h2>
          <ProgressView
            streamUrl={`/api/discovery/${discoveryJobId}/stream`}
            onComplete={handleDiscoveryComplete}
          />
        </div>
      )}

      {/* Screen list */}
      {screens.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">
              Keşfedilen Ekranlar ({screens.length})
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleAll}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {selected.size === screens.length
                  ? "Tüm seçimi kaldır"
                  : "Tümünü seç"}
              </button>
              <span className="text-sm text-gray-500">
                {selected.size} seçili
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            {screens.map((screen) => (
              <label
                key={screen.path}
                className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selected.has(screen.path)
                    ? "border-blue-400 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(screen.path)}
                  onChange={() => toggleScreen(screen.path)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    {/* Screenshot thumbnail */}
                    <img
                      src={`/screenshots/${screen.screenshotPath.split("/").pop()}`}
                      alt={screen.title}
                      className="w-16 h-10 object-cover rounded border border-gray-200 flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {screen.title || screen.path}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {screen.path}
                      </p>
                      <p className="text-xs text-gray-400">
                        Derinlik: {screen.depth}
                      </p>
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Start documentation */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-500">
              {selected.size} ekran için döküman oluşturulacak
            </p>
            <button
              onClick={startDocumentation}
              disabled={selected.size === 0 || docJobLoading}
              className="px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {docJobLoading
                ? "Başlatılıyor..."
                : "📝 Döküman Oluştur"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
