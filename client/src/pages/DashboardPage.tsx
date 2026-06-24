import { useState, useEffect } from "react";

interface Stats {
  documents: { total: number; draft: number; approved: number; published: number };
  jobs: { total: number; running: number; completed: number; failed: number };
  screens: { total: number };
  references: { confluence: number; swagger: number; documents: number; templates: number };
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; totalCostUsd: number };
  recentJobs: Array<{
    id: string; type: string; status: string; createdAt: string;
    progress: { current: number; total: number; message: string };
  }>;
  recentDocs: Array<{ id: string; screenTitle: string; screenPath: string; status: string; updatedAt: string }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) {
    return <div className="p-7 text-gray-400 text-[13px]">Yükleniyor...</div>;
  }

  return (
    <div className="p-7 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Genel Bakış</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">
          Son işlemler, durum özetleri ve maliyet takibi.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Dökümanlar" value={stats.documents.total} sub={`${stats.documents.draft} taslak · ${stats.documents.approved} onaylı · ${stats.documents.published} yayında`} accent="blue" />
        <Kpi label="Job'lar" value={stats.jobs.total} sub={`${stats.jobs.running} çalışıyor · ${stats.jobs.failed} hata`} accent="violet" />
        <Kpi label="Keşfedilen Ekran" value={stats.screens.total} sub="Toplam tarama" accent="green" />
        <Kpi label="Maliyet (USD)" value={`$${stats.usage.totalCostUsd.toFixed(2)}`} sub={`${(stats.usage.inputTokens / 1000).toFixed(0)}K in · ${(stats.usage.outputTokens / 1000).toFixed(0)}K out${stats.usage.cacheReadTokens ? ` · ${(stats.usage.cacheReadTokens / 1000).toFixed(0)}K cache` : ""}`} accent="amber" />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-2 gap-5">
        {/* Recent jobs */}
        <Section title="Son Job'lar" emptyText="Henüz job yok">
          {stats.recentJobs.map((job) => (
            <div key={job.id} className="px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      job.status === "running"   ? "bg-amber-400 animate-pulse" :
                      job.status === "completed" ? "bg-green-400" :
                      job.status === "failed"    ? "bg-red-400" :
                                                   "bg-gray-300"
                    }`} />
                    <span className="text-[13px] font-medium text-gray-800">
                      {job.type === "discovery" ? "Ekran Keşfi" : "Döküman Üretimi"}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{job.progress.message}</p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-[11px] text-gray-500">{job.progress.current}/{job.progress.total}</p>
                  <p className="text-[10px] text-gray-400">{new Date(job.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}</p>
                </div>
              </div>
            </div>
          ))}
        </Section>

        {/* Recent documents */}
        <Section title="Son Dökümanlar" emptyText="Henüz döküman yok">
          {stats.recentDocs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => window.dispatchEvent(new CustomEvent("navigate", { detail: "documents" }))}
              className="w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-gray-800 truncate">{doc.screenTitle}</p>
                  <p className="text-[11px] text-gray-400 truncate">{doc.screenPath}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  doc.status === "published" ? "bg-blue-100 text-blue-700" :
                  doc.status === "approved"  ? "bg-green-100 text-green-700" :
                                                "bg-gray-100 text-gray-600"
                }`}>
                  {doc.status === "draft" ? "Taslak" : doc.status === "approved" ? "Onaylı" : "Yayında"}
                </span>
              </div>
            </button>
          ))}
        </Section>
      </div>

      {/* References summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-[13px] font-semibold text-gray-700 mb-4">Bağlam Kaynakları</h2>
        <div className="grid grid-cols-4 gap-4">
          <RefStat label="Confluence Sayfası" value={stats.references.confluence} />
          <RefStat label="Swagger API" value={stats.references.swagger} />
          <RefStat label="Referans Döküman" value={stats.references.documents} />
          <RefStat label="Şablon" value={stats.references.templates} />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent: "blue" | "violet" | "green" | "amber" }) {
  const colors = {
    blue: "from-blue-500 to-blue-600",
    violet: "from-violet-500 to-violet-600",
    green: "from-green-500 to-green-600",
    amber: "from-amber-500 to-amber-600",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${colors[accent]} opacity-80`} />
      </div>
      <p className="text-[22px] font-bold text-gray-900 leading-none mb-1.5">{value}</p>
      <p className="text-[11px] text-gray-400">{sub}</p>
    </div>
  );
}

function Section({ title, children, emptyText }: { title: string; children: React.ReactNode; emptyText: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-[13px] font-semibold text-gray-700">{title}</h3>
      </div>
      <div>
        {hasChildren ? children : <p className="px-4 py-8 text-center text-[12px] text-gray-400">{emptyText}</p>}
      </div>
    </div>
  );
}

function RefStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[24px] font-bold text-gray-900 leading-none">{value}</p>
      <p className="text-[11px] text-gray-400 mt-1">{label}</p>
    </div>
  );
}
