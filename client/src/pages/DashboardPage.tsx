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

const go = (page: string) => window.dispatchEvent(new CustomEvent("navigate", { detail: page }));

const I = {
  discovery: "M8 1.5A6.5 6.5 0 1 1 1.5 8 6.5 6.5 0 0 1 8 1.5zM10.5 10.5l3 3",
  documents: "M3 2h7l3 3v9H3V2zm7 0v3h3M6 7h5M6 9.5h5M6 12h3",
  references: "M2 3h12v2H2zM2 7h9v2H2zM2 11h7v2H2z",
  settings:
    "M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0-3.5v2m0 9v2M3.5 3.5l1.4 1.4m5.2 5.2 1.4 1.4M1.5 8h2m9 0h2M3.5 12.5l1.4-1.4m5.2-5.2 1.4-1.4",
  bolt: "M9 1L3 9h4l-1 6 6-8H8l1-6z",
};

function Ic({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
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
    return <div className="p-8 text-fg3 text-[13px]">Yükleniyor…</div>;
  }

  return (
    <div className="p-7 max-w-5xl mx-auto space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[23px] font-semibold text-fg tracking-tight">Genel Bakış</h1>
          <p className="text-[13px] text-fg3 mt-0.5">Son işlemler, durum özetleri ve maliyet takibi.</p>
        </div>
      </div>

      {/* Hero callout */}
      <div className="glass rounded-xl p-5 flex items-center gap-5 overflow-hidden relative">
        <div className="orb w-11 h-11 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] section-label mb-1">Sistem · Çevrimiçi</p>
          <h2 className="text-[15px] font-semibold text-fg">Doc Agent hazır — yeni bir keşfe başla</h2>
          <p className="text-[12px] text-fg2 mt-0.5">
            Hedef uygulamayı tara, ekranları seç ve Claude ile Türkçe kullanıcı kılavuzu üret.
          </p>
        </div>
        <button
          onClick={() => go("discovery")}
          className="btn btn-primary flex-shrink-0 shadow-[0_0_18px_rgba(45,212,191,0.35)]"
        >
          <Ic d={I.discovery} size={13} /> Keşfe Başla
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Dökümanlar" value={stats.documents.total} sub={`${stats.documents.draft} taslak · ${stats.documents.approved} onaylı · ${stats.documents.published} yayında`} icon={I.documents} />
        <Kpi label="Job'lar" value={stats.jobs.total} sub={`${stats.jobs.running} çalışıyor · ${stats.jobs.failed} hata`} icon={I.bolt} />
        <Kpi label="Keşfedilen Ekran" value={stats.screens.total} sub="Toplam tarama" icon={I.discovery} />
        <Kpi label="Maliyet (USD)" value={`$${stats.usage.totalCostUsd.toFixed(2)}`} sub={`${(stats.usage.inputTokens / 1000).toFixed(0)}K in · ${(stats.usage.outputTokens / 1000).toFixed(0)}K out${stats.usage.cacheReadTokens ? ` · ${(stats.usage.cacheReadTokens / 1000).toFixed(0)}K cache` : ""}`} icon="M8 1v14M4 4h6a2 2 0 0 1 0 4H6a2 2 0 0 0 0 4h6" amber />
      </div>

      {/* Quick actions */}
      <div>
        <p className="section-label mb-2.5">Hızlı Eylemler</p>
        <div className="grid grid-cols-4 gap-3">
          <Action icon={I.discovery} title="Ekran Keşfi" desc="Uygulamayı tara, analiz et" onClick={() => go("discovery")} />
          <Action icon={I.documents} title="Dökümanlar" desc="Üretilen kılavuzlar" onClick={() => go("documents")} />
          <Action icon={I.references} title="Referanslar" desc="Confluence · Jira · BRD" onClick={() => go("references")} />
          <Action icon={I.settings} title="Ayarlar" desc="Backend, hedef, analist" onClick={() => go("settings")} />
        </div>
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-2 gap-5">
        <Section title="Son Job'lar" emptyText="Henüz job yok">
          {stats.recentJobs.map((job) => (
            <div key={job.id} className="px-4 py-3 border-b border-line/60 last:border-0 hover:bg-surface2/60 transition-colors">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full glow-dot ${
                      job.status === "running"   ? "bg-amber-400 text-amber-400 animate-pulse" :
                      job.status === "completed" ? "bg-green-400 text-green-400" :
                      job.status === "failed"    ? "bg-red-400 text-red-400" :
                                                   "bg-fg3 text-fg3"
                    }`} />
                    <span className="text-[13px] font-medium text-fg">
                      {job.type === "discovery" ? "Ekran Keşfi" : "Döküman Üretimi"}
                    </span>
                  </div>
                  <p className="text-[11px] text-fg3 mt-0.5 truncate">{job.progress.message}</p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-[11px] text-fg2 font-mono">{job.progress.current}/{job.progress.total}</p>
                  <p className="text-[10px] text-fg3">{new Date(job.createdAt).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}</p>
                </div>
              </div>
            </div>
          ))}
        </Section>

        <Section title="Son Dökümanlar" emptyText="Henüz döküman yok">
          {stats.recentDocs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => go("documents")}
              className="w-full text-left px-4 py-3 border-b border-line/60 last:border-0 hover:bg-surface2/60 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-fg truncate">{doc.screenTitle}</p>
                  <p className="text-[11px] text-fg3 truncate">{doc.screenPath}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  doc.status === "published" ? "bg-blue-100 text-blue-700" :
                  doc.status === "approved"  ? "bg-green-100 text-green-700" :
                                                "bg-surface3 text-fg2"
                }`}>
                  {doc.status === "draft" ? "Taslak" : doc.status === "approved" ? "Onaylı" : "Yayında"}
                </span>
              </div>
            </button>
          ))}
        </Section>
      </div>

      {/* References summary */}
      <div className="glass rounded-xl p-5">
        <p className="section-label mb-4">Bağlam Kaynakları</p>
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

function Kpi({ label, value, sub, icon, amber }: { label: string; value: string | number; sub: string; icon: string; amber?: boolean }) {
  return (
    <div className="glass glass-hover rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[10px] font-semibold text-fg3 uppercase tracking-wider">{label}</p>
        <span className={`icon-tile ${amber ? "!bg-amber-500/15 !text-amber-400 !border-amber-500/30" : ""}`} style={{ width: 28, height: 28 }}>
          <Ic d={icon} size={13} />
        </span>
      </div>
      <p className="text-[24px] font-bold text-fg leading-none mb-1.5 tracking-tight">{value}</p>
      <p className="text-[11px] text-fg3">{sub}</p>
    </div>
  );
}

function Action({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="glass glass-hover rounded-xl p-4 text-left flex flex-col gap-2.5">
      <span className="icon-tile">
        <Ic d={icon} size={15} />
      </span>
      <div>
        <p className="text-[13px] font-semibold text-fg">{title}</p>
        <p className="text-[11px] text-fg3 mt-0.5">{desc}</p>
      </div>
    </button>
  );
}

function Section({ title, children, emptyText }: { title: string; children: React.ReactNode; emptyText: string }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-line/70">
        <h3 className="text-[12px] font-semibold text-fg2 uppercase tracking-wide">{title}</h3>
      </div>
      <div>
        {hasChildren ? children : <p className="px-4 py-10 text-center text-[12px] text-fg3">{emptyText}</p>}
      </div>
    </div>
  );
}

function RefStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[26px] font-bold text-fg leading-none tracking-tight">{value}</p>
      <p className="text-[11px] text-fg3 mt-1">{label}</p>
    </div>
  );
}
