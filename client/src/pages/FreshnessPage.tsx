import { useState, useEffect, useCallback } from "react";
import { jobs } from "../lib/api";
import { useToast } from "../components/Toast";

interface FreshnessPageProps {
  onJobStarted: (jobId: string) => void;
}

type Status = "fresh" | "screen-changed" | "sources-changed" | "warning" | "no-doc";

interface Row {
  path: string;
  title: string;
  screenshotPath: string;
  status: Status;
  docStatus?: string;
  docUpdatedAt?: string;
  discoveredAt?: string;
}

interface FreshnessData {
  sourcesUpdatedAt: string | null;
  summary: { total: number; fresh: number; stale: number; warning: number; noDoc: number };
  rows: Row[];
}

const META: Record<Status, { label: string; cls: string }> = {
  fresh:            { label: "Güncel",        cls: "bg-green-100 text-green-700" },
  "screen-changed": { label: "Ekran değişti", cls: "bg-amber-100 text-amber-700" },
  "sources-changed":{ label: "Kaynak değişti",cls: "bg-blue-100 text-blue-700" },
  warning:          { label: "Uyarılı",       cls: "bg-red-100 text-red-700" },
  "no-doc":         { label: "Doküman yok",   cls: "bg-surface3 text-fg2" },
};

const isStale = (s: Status) => s !== "fresh"; // güncel olmayan her şey güncellenebilir

export default function FreshnessPage({ onJobStarted }: FreshnessPageProps) {
  const toast = useToast();
  const [data, setData] = useState<FreshnessData | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/freshness")
      .then((r) => r.json())
      .then((d: FreshnessData) => {
        setData(d);
        // Varsayılan: güncel olmayan (değişen/yok/uyarılı) ekranları seç.
        setSelected(new Set(d.rows.filter((r) => isStale(r.status)).map((r) => r.path)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  function toggle(path: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
  }

  async function refreshSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      // force=false → değişmeyenler zaten atlanır (0 token); güvenli.
      const { jobId } = await jobs.start(Array.from(selected), false);
      onJobStarted(jobId);
    } catch (e) {
      toast.show((e as Error).message, "error");
      setBusy(false);
    }
  }

  if (!data) return <div className="p-8 text-fg3 text-[13px]">Yükleniyor…</div>;

  const fmt = (d?: string) => (d ? new Date(d).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const staleCount = data.rows.filter((r) => isStale(r.status)).length;

  return (
    <div className="p-7 max-w-6xl mx-auto space-y-5 fade-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[23px] font-semibold text-fg tracking-tight">Tazelik</h1>
          <p className="text-[13px] text-fg3 mt-0.5">
            Hangi kılavuzlar güncel, hangileri değişmiş? Yalnız değişenleri seçip güncelle — değişmeyenler atlanır (0 token).
          </p>
        </div>
        <button
          onClick={refreshSelected}
          disabled={selected.size === 0 || busy}
          className="btn btn-primary flex-shrink-0 disabled:opacity-40"
        >
          {busy ? "Başlatılıyor…" : `Seçileni Güncelle (${selected.size})`}
        </button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-4">
        <Tile label="Güncel" value={data.summary.fresh} tone="good" />
        <Tile label="Değişti" value={data.summary.stale} tone="warn" />
        <Tile label="Uyarılı" value={data.summary.warning} tone="crit" />
        <Tile label="Doküman yok" value={data.summary.noDoc} tone="muted" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 text-[12px]">
        <button
          onClick={() => setSelected(new Set(data.rows.filter((r) => isStale(r.status)).map((r) => r.path)))}
          className="text-accent hover:underline"
        >
          Değişenleri seç ({staleCount})
        </button>
        <span className="text-fg3">·</span>
        <button onClick={() => setSelected(new Set(data.rows.map((r) => r.path)))} className="text-fg2 hover:text-fg">Tümünü seç</button>
        <span className="text-fg3">·</span>
        <button onClick={() => setSelected(new Set())} className="text-fg2 hover:text-fg">Seçimi kaldır</button>
        <span className="text-fg3 ml-auto font-mono text-[11px]">
          Kaynak son senkron: {fmt(data.sourcesUpdatedAt ?? undefined)}
        </span>
      </div>

      {/* List */}
      <div className="glass rounded-xl overflow-hidden">
        {data.rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-fg3">
            Henüz keşfedilmiş ekran yok. Önce <b className="text-fg2">Ekran Keşfi</b>'nden tara.
          </p>
        ) : (
          data.rows.map((r) => {
            const m = META[r.status];
            const sel = selected.has(r.path);
            return (
              <label
                key={r.path}
                className={`flex items-center gap-3 px-4 py-3 border-b border-line/60 last:border-0 cursor-pointer transition-colors ${sel ? "bg-accent-soft/40" : "hover:bg-surface2/50"}`}
              >
                <input type="checkbox" checked={sel} onChange={() => toggle(r.path)} className="accent-blue-600 flex-shrink-0" />
                <img
                  src={`/screenshots/${r.screenshotPath.split("/").pop()}`}
                  alt=""
                  className="w-16 h-10 object-cover rounded border border-line flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-fg truncate">{r.title}</p>
                  <p className="text-[11px] text-fg3 truncate font-mono">{r.path}</p>
                </div>
                <div className="text-right hidden sm:block mr-2">
                  <p className="text-[11px] text-fg2">Doküman: {fmt(r.docUpdatedAt)}</p>
                  <p className="text-[10px] text-fg3">Keşif: {fmt(r.discoveredAt)}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${m.cls}`}>{m.label}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" | "crit" | "muted" }) {
  const dot = tone === "good" ? "bg-green-400 text-green-400"
    : tone === "warn" ? "bg-amber-400 text-amber-400"
    : tone === "crit" ? "bg-red-400 text-red-400"
    : "bg-fg3 text-fg3";
  return (
    <div className="glass glass-hover rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full glow-dot ${dot}`} />
        <p className="text-[10px] font-semibold text-fg3 uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-[24px] font-bold text-fg leading-none tracking-tight">{value}</p>
    </div>
  );
}
