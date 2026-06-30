import { useState, useEffect, useCallback } from "react";
import { useToast } from "../components/Toast";

interface Job {
  id: string;
  type: "discovery" | "documentation";
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: { current: number; total: number; message: string };
  error?: string;
  /** Üretilmemiş ekran sayısı; failed/cancelled job'larda > 0 olabilir.
   *  Eski sürümde başlatılmış job'lar için undefined (screenPaths kaydı yok). */
  missingScreenCount?: number;
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<"all" | "discovery" | "documentation">("all");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [load]);

  const sorted = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filtered = filter === "all" ? sorted : sorted.filter((j) => j.type === filter);

  function duration(j: Job): string {
    if (!j.completedAt) return "—";
    const ms = new Date(j.completedAt).getTime() - new Date(j.createdAt).getTime();
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}d ${sec % 60}s`;
  }

  async function retryMissing(id: string, count: number) {
    if (!confirm(`Bu job'tan ${count} eksik ekran için yeni bir üretim başlatılacak. Tamamlanmış olanlar yeniden ödenmez. Devam?`)) return;
    try {
      const r = await fetch(`/api/jobs/${id}/retry-missing`, {
        method: "POST",
        headers: { "X-DocAgent": "1" },
      });
      const d = await r.json() as { jobId?: string; error?: string; count?: number };
      if (!r.ok || !d.jobId) {
        toast.show(d.error ?? "Yeniden üretim başlatılamadı", "error");
        return;
      }
      toast.show(`${d.count} eksik ekran için yeni job başlatıldı`, "success");
      load();
    } catch (e) {
      toast.show((e as Error).message, "error");
    }
  }

  async function deleteOne(id: string) {
    if (!confirm("Bu job kaydını silmek istediğinden emin misin?")) return;
    try {
      const r = await fetch(`/api/jobs/${id}`, { method: "DELETE", headers: { "X-DocAgent": "1" } });
      // r.ok kontrol edilmezse sunucu hatası 'silindi' diye yutuluyordu →
      // kullanıcı job'un kalmaya devam ettiğini "silinemiyor" diye görüyordu.
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Silme başarısız (HTTP ${r.status})`);
      }
      await load();
      toast.show("Job silindi", "success");
    } catch (e) {
      toast.show(`Silme hatası: ${(e as Error).message}`, "error");
    }
  }

  async function cleanupCompleted() {
    if (!confirm("Tüm tamamlanmış (completed + failed) job kayıtlarını silmek üzeresin. Devam edilsin mi?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/jobs/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DocAgent": "1" },
        body: JSON.stringify({ status: ["completed", "failed"] }),
      });
      if (!r.ok) throw new Error(`Temizleme başarısız (HTTP ${r.status})`);
      const d = await r.json() as { removed: number };
      toast.show(`${d.removed} job silindi`, "success");
      await load();
    } catch (e) {
      toast.show((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function cleanupAll() {
    if (!confirm("TÜM job kayıtlarını silmek üzeresin (çalışıyor görünenler dahil). Devam edilsin mi?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/jobs/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DocAgent": "1" },
        body: JSON.stringify({ status: ["completed", "failed", "running", "pending"] }),
      });
      if (!r.ok) throw new Error(`Temizleme başarısız (HTTP ${r.status})`);
      const d = await r.json() as { removed: number };
      toast.show(`${d.removed} job silindi`, "success");
      await load();
    } catch (e) {
      toast.show((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-7 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900">Geçmiş</h1>
          <p className="text-[13px] text-gray-400 mt-0.5">
            Tüm keşif ve döküman üretimi job'larının kaydı.
          </p>
        </div>
        <div className="flex gap-2">
          {jobs.some((j) => j.status === "completed" || j.status === "failed") && (
            <button
              onClick={cleanupCompleted}
              disabled={busy}
              className="px-3 py-1.5 text-[12px] border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Tamamlananları Temizle
            </button>
          )}
          {jobs.some((j) => j.status === "running" || j.status === "pending") && (
            <button
              onClick={cleanupAll}
              disabled={busy}
              className="px-3 py-1.5 text-[12px] border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50"
              title="Çalışıyor görünen orphan job'ları dahil hepsini sil"
            >
              Tümünü Sil
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(["all", "discovery", "documentation"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3 py-1.5 text-[12px] rounded-full border transition-colors ${
              filter === t
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
            }`}
          >
            {t === "all" ? `Tümü (${jobs.length})` : t === "discovery" ? "Keşif" : "Döküman"}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-gray-400">Bu kategoride job yok.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Durum</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Tip</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">İlerleme</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Süre</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Tarih</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id} className="border-b border-gray-50 hover:bg-gray-50 group">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        job.status === "running"   ? "bg-amber-400 animate-pulse" :
                        job.status === "completed" ? "bg-green-400" :
                        job.status === "failed"    ? "bg-red-400" :
                                                     "bg-gray-300"
                      }`} />
                      <span className="text-[12px] text-gray-600">
                        {job.status === "running"   ? "Çalışıyor" :
                         job.status === "completed" ? "Tamam" :
                         job.status === "failed"    ? "Hata" :
                                                      "Bekliyor"}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {job.type === "discovery" ? "Keşif" : "Döküman"}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{job.progress.current} / {job.progress.total}</p>
                    <p className="text-[11px] text-gray-400 truncate max-w-xs">{job.progress.message}</p>
                    {job.type === "documentation" &&
                     job.status !== "running" &&
                     job.status !== "pending" &&
                     (job.missingScreenCount ?? 0) > 0 && (
                      <button
                        onClick={() => retryMissing(job.id, job.missingScreenCount!)}
                        className="mt-1 px-2 py-0.5 text-[11px] rounded-md border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
                        title="Yalnız üretilmemiş ekranlar için yeni job başlat (token tasarrufu)"
                      >
                        ⟳ Eksikleri Üret ({job.missingScreenCount})
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{duration(job)}</td>
                  <td className="px-4 py-3 text-gray-400 text-[12px]">
                    {new Date(job.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteOne(job.id)}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity text-[12px]"
                      title={job.status === "running" ? "Zorla sil (orphan job ise)" : "Sil"}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
