import { useState, useEffect } from "react";

interface UpdateInfo {
  hash: string;
  fullHash: string;
  date: string;
  message: string;
  branch: string;
  author: string;
  behind: number;
  remoteHash: string;
  upToDate: boolean;
}

export default function UpdatePage() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function loadInfo() {
    setError(null);
    fetch("/api/update/info")
      .then((r) => r.json())
      .then(setInfo)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    loadInfo();
  }, []);

  // Poll the update log while updating
  useEffect(() => {
    if (!updating) return;
    const i = setInterval(async () => {
      try {
        const r = await fetch("/api/update/log");
        if (!r.ok) {
          // Server is restarting → expect this
          return;
        }
        const d = await r.json() as { lines: string[] };
        setLog(d.lines);
      } catch {
        // Server down (mid-restart). Will recover.
      }
    }, 2000);
    return () => clearInterval(i);
  }, [updating]);

  // Once updating, poll /api/health until it comes back, then reload page.
  useEffect(() => {
    if (!updating) return;
    let attempts = 0;
    let serverWasDown = false;
    const i = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch("/api/health");
        if (r.ok) {
          if (serverWasDown && attempts > 2) {
            // Server came back after a restart cycle → reload UI
            clearInterval(i);
            setTimeout(() => window.location.reload(), 800);
          }
        }
      } catch {
        serverWasDown = true;
      }
      if (attempts > 90) clearInterval(i); // 3 dakika güvenlik durdurması
    }, 2000);
    return () => clearInterval(i);
  }, [updating]);

  async function handleUpdate() {
    if (!confirm("GitHub'dan son değişiklikler çekilip uygulama yeniden başlatılacak. Devam edilsin mi?"))
      return;
    setUpdating(true);
    setLog([]);
    try {
      const r = await fetch("/api/update/run", { method: "POST" });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) {
        setError(d.error ?? "Bilinmeyen hata");
        setUpdating(false);
      }
    } catch (e) {
      setError((e as Error).message);
      setUpdating(false);
    }
  }

  function fmtDate(iso: string): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "medium" });
    } catch {
      return iso;
    }
  }

  return (
    <div className="p-7 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Güncelleme</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">
          GitHub'daki son değişiklikleri çekin. Güncelleme sonrası uygulama otomatik yeniden başlar.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Current version */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-gray-800">Mevcut Sürüm</h2>
          {info && (
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                info.upToDate
                  ? "bg-green-100 text-green-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {info.upToDate
                ? "✓ Güncel"
                : `${info.behind} commit geride`}
            </span>
          )}
        </div>

        {info ? (
          <div className="font-mono text-[12px] text-gray-600 leading-relaxed">
            <span className="bg-gray-900 text-green-400 px-2 py-0.5 rounded">
              {info.hash}
            </span>
            <span className="mx-2 text-gray-400">·</span>
            <span>{fmtDate(info.date)}</span>
            <span className="mx-2 text-gray-400">·</span>
            <span className="text-gray-700">{info.message || "(mesaj yok)"}</span>
            {info.author && (
              <div className="text-[11px] text-gray-400 mt-1">
                Yazar: {info.author} · Branch: {info.branch}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-gray-400">Bilgi yükleniyor…</p>
        )}

        <button
          onClick={handleUpdate}
          disabled={updating || !info}
          className="mt-4 px-5 py-2 bg-blue-600 text-white text-[13px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {updating && (
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          {updating ? "Güncelleniyor…" : "Güncelle"}
        </button>
      </div>

      {/* Live log during update */}
      {updating && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-[13px] font-semibold text-gray-700 mb-3">İşlem Kaydı</h2>
          <div className="bg-gray-900 rounded-lg p-4 max-h-72 overflow-y-auto font-mono text-[11px] text-green-300 whitespace-pre-wrap">
            {log.length === 0 ? (
              <span className="text-gray-500">Bekleniyor…</span>
            ) : (
              log.join("\n")
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
            Sunucular yeniden başlatılırken bu sayfa kısa süreliğine bağlantıyı kaybedebilir. Yeniden bağlantı kurulduğunda sayfa otomatik yenilenecek.
          </p>
        </div>
      )}

      {/* How it works */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h2 className="text-[13px] font-semibold text-blue-900 mb-2">Nasıl Çalışır?</h2>
        <p className="text-[12px] text-blue-800 leading-relaxed">
          "Güncelle" butonuna basıldığında GitHub'dan son commit'ler çekilir, gerekli paketler yüklenir ve uygulama otomatik olarak yeniden başlatılır. Sayfa birkaç saniye içinde otomatik yenilenir.
        </p>
      </div>
    </div>
  );
}
