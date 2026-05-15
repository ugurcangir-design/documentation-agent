import { useState, useEffect } from "react";

interface Job {
  id: string;
  type: "discovery" | "documentation";
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: { current: number; total: number; message: string };
  error?: string;
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<"all" | "discovery" | "documentation">("all");

  useEffect(() => {
    const load = () => fetch("/api/jobs").then((r) => r.json()).then(setJobs).catch(() => {});
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  const sorted = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filtered = filter === "all" ? sorted : sorted.filter((j) => j.type === filter);

  function duration(j: Job): string {
    if (!j.completedAt) return "—";
    const ms = new Date(j.completedAt).getTime() - new Date(j.createdAt).getTime();
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}d ${sec % 60}s`;
  }

  return (
    <div className="p-7 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Geçmiş</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">
          Tüm keşif ve döküman üretimi job'larının kaydı.
        </p>
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id} className="border-b border-gray-50 hover:bg-gray-50">
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
                  </td>
                  <td className="px-4 py-3 text-gray-500">{duration(job)}</td>
                  <td className="px-4 py-3 text-gray-400 text-[12px]">
                    {new Date(job.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
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
