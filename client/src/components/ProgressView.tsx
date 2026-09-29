import { useEffect, useMemo, useRef, useState } from "react";
import type { JobEvent } from "../types";

interface ProgressViewProps {
  streamUrl: string;
  total?: number;
  onComplete?: () => void;
  /** Terminal HATA (failed/cancelled) olduğunda çağrılır — çağıran tarafın
   *  "çalışıyor" durumunu sıfırlayıp yeniden denemeye izin vermesi için. */
  onError?: (message: string) => void;
  onCancel?: () => void;
  onPause?: () => Promise<void> | void;
  onResume?: () => Promise<void> | void;
  /** Aşama etiketleri (soldan sağa). Verilirse üstte bir aşama göstergesi
   *  çizilir. Verilmezse gösterge atlanır (mantık etkilenmez). */
  stages?: string[];
}

type ScreenStatus = "ok" | "warn" | "skip";
interface ScreenItem { title: string; status: ScreenStatus; }

/** Aktivite mesajından kaba bir aşama indeksi türet (yalnız görsel gösterge). */
function deriveStageIndex(msg: string, done: boolean, error: boolean, count: number): number {
  if (done) return error ? -1 : count - 1;
  const m = msg.toLowerCase();
  if (/bağlam|yükleniyor|hazırl|başlat/.test(m)) return 0;
  if (/kapsam|fix-up|eksik|stil|kalite|doğrula/.test(m)) return Math.min(3, count - 1);
  if (/yaz|üret|kılavuz|sekme|canlı|gözlem|kanıt/.test(m)) return Math.min(2, count - 1);
  if (/analiz|tara|keşif|etkileşim|state/.test(m)) return Math.min(1, count - 1);
  return Math.min(1, count - 1);
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
}

export default function ProgressView({
  streamUrl,
  total = 0,
  onComplete,
  onError,
  onCancel,
  onPause,
  onResume,
  stages,
}: ProgressViewProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [evtTotal, setEvtTotal] = useState(0);
  const [screens, setScreens] = useState<ScreenItem[]>([]);
  const [activity, setActivity] = useState("Başlatılıyor…");
  const [warnCount, setWarnCount] = useState(0);
  const [errCount, setErrCount] = useState(0);
  const [done, setDone] = useState(false);
  const [endedWithError, setEndedWithError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [waitDismissed, setWaitDismissed] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const endedRef = useRef(false);
  const startedAt = useRef<number>(Date.now());

  // ── SSE (mantık DEĞİŞMEDİ — yalnız türetilmiş durum eklendi) ──────
  useEffect(() => {
    endedRef.current = false;
    const es = new EventSource(streamUrl);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data as string) as JobEvent;

      // Tek ekran hatası (non-terminal) → log'da görünür işaretle ama
      // stream'i KAPATMA; job diğer ekranlarla devam eder.
      const prefix = event.type === "error" ? "⚠ " : "";
      setLogs((prev) => [...prev, prefix + event.message]);

      if (event.current !== undefined) setCurrent(event.current);
      if (event.total !== undefined && event.total > 0) setEvtTotal(event.total);
      if (event.type === "progress" || event.type === "screen") setActivity(event.message);
      if (event.type === "error") setErrCount((n) => n + 1);

      // Ekran tamamlandı olayları → canlı kart listesi (görsel ilerleyiş).
      if (event.type === "screen") {
        const data = (event.data ?? {}) as { screenTitle?: string; screenPath?: string };
        const msg = event.message || "";
        const status: ScreenStatus = msg.startsWith("⚠") ? "warn" : msg.startsWith("↺") ? "skip" : "ok";
        if (status === "warn") setWarnCount((n) => n + 1);
        const title = data.screenTitle || msg.replace(/^[✓⚠↺]\s*/, "") || "Ekran";
        setScreens((prev) => [...prev, { title, status }]);
      }

      // Pause/resume signals from the server
      if (typeof event.message === "string") {
        if (event.message.startsWith("⏸")) setPaused(true);
        if (event.message.startsWith("▶")) {
          setPaused(false);
          setWaitDismissed(false);
        }
      }

      // Yalnız TERMINAL olaylar stream'i kapatır. "error" tek-ekran
      // hatasıdır (job sürer) — burada job'ı bitmiş sayma.
      if (event.type === "complete" || event.type === "failed" || event.type === "cancelled") {
        setDone(true);
        endedRef.current = true;
        es.close();
        if (event.type === "complete") {
          onComplete?.();
        } else {
          setEndedWithError(true);
          onError?.(event.message || "İşlem başarısız oldu");
        }
      }
    };

    es.onerror = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      setLogs((prev) => [...prev, "Bağlantı kesildi."]);
      setDone(true);
      setEndedWithError(true);
      es.close();
      onError?.("Sunucuyla bağlantı kesildi. İşlem durdu — yeniden deneyin.");
    };

    return () => es.close();
  }, [streamUrl]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, logOpen]);

  // Geçen süre sayacı (job bitince durur).
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [done]);

  async function handlePause() {
    if (!onPause) return;
    setActionBusy(true);
    try { await onPause(); } finally { setActionBusy(false); }
  }
  async function handleResume() {
    if (!onResume) return;
    setActionBusy(true);
    try { await onResume(); } finally { setActionBusy(false); }
  }

  const effTotal = evtTotal || total;
  const pct = effTotal > 0
    ? Math.min(100, (current / effTotal) * 100)
    : done && !endedWithError ? 100 : 0;
  const running = !done && !paused;

  const stageIdx = useMemo(
    () => (stages && stages.length > 0 ? deriveStageIndex(activity, done, endedWithError, stages.length) : -2),
    [stages, activity, done, endedWithError]
  );

  // Dairesel ring geometrisi
  const R = 34, C = 2 * Math.PI * R;
  const ringColor = endedWithError ? "var(--c-red)" : paused ? "#f59e0b" : "var(--c-accent)";

  return (
    <div className="space-y-4">
      {/* ── Hero: orb + ring + aktivite ───────────────────────────── */}
      <div className="glass rounded-xl p-5 flex items-center gap-5 relative overflow-hidden">
        {/* Dairesel ilerleme ring'i */}
        <div className="relative flex-shrink-0" style={{ width: 84, height: 84 }}>
          <svg width="84" height="84" className="-rotate-90">
            <circle cx="42" cy="42" r={R} fill="none" stroke="var(--c-border)" strokeWidth="6" />
            <circle
              cx="42" cy="42" r={R} fill="none" stroke={ringColor} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
              style={{ transition: "stroke-dashoffset .5s ease, stroke .3s" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {running
              ? <div className="orb w-4 h-4 mb-0.5" />
              : <span className="text-lg">{endedWithError ? "✕" : paused ? "⏸" : "✓"}</span>}
            <span className="text-[15px] font-bold text-fg tabular-nums">{Math.round(pct)}%</span>
          </div>
        </div>

        {/* Aktivite metni + meta */}
        <div className="flex-1 min-w-0">
          <div className="section-label mb-1">
            {done ? (endedWithError ? "Durdu" : "Tamamlandı") : paused ? "Duraklatıldı" : "Çalışıyor"}
          </div>
          <div className="text-[15px] font-semibold text-fg truncate" title={activity}>{activity}</div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-fg3 flex-wrap">
            {effTotal > 0 && (
              <span className="tabular-nums">
                <span className="text-fg2 font-medium">{current}</span>/{effTotal} ekran
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${running ? "bg-accent glow-dot text-accent animate-pulse" : "bg-fg3"}`} />
              {fmtElapsed(elapsed)}
            </span>
            {warnCount > 0 && <span className="text-amber-500">⚠ {warnCount} uyarı</span>}
            {errCount > 0 && <span className="text-red-500">✕ {errCount} hata</span>}
          </div>
        </div>

        {/* Kontroller */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          {running && onPause && (
            <button onClick={handlePause} disabled={actionBusy}
              className="btn text-xs px-3 py-1.5 disabled:opacity-50" title="Bir sonraki kontrol noktasında duraklat">
              ⏸ Duraklat
            </button>
          )}
          {!done && onCancel && (
            <button onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 transition-colors">
              İptal
            </button>
          )}
        </div>
      </div>

      {/* ── Aşama göstergesi ──────────────────────────────────────── */}
      {stages && stages.length > 0 && (
        <div className="flex items-center gap-1.5">
          {stages.map((label, i) => {
            const state = stageIdx === -1 ? (i === 0 ? "active" : "todo")
              : i < stageIdx ? "done" : i === stageIdx ? "active" : "todo";
            return (
              <div key={label} className="flex-1 flex items-center gap-1.5 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className={`h-1 rounded-full transition-colors ${
                    state === "done" ? "bg-accent" : state === "active" ? "bg-accent/60" : "bg-line"
                  }`} />
                  <div className={`mt-1 text-[10px] truncate transition-colors ${
                    state === "todo" ? "text-fg3" : "text-fg2 font-medium"
                  }`}>
                    {state === "done" ? "✓ " : state === "active" && running ? "• " : ""}{label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Duraklatma bildirimi ──────────────────────────────────── */}
      {paused && !done && !waitDismissed && (
        <div className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-3 border-l-2 border-l-amber-400">
          <div className="text-[13px] text-fg2">
            ⏸ Job duraklatıldı. Devam etmek için aşağıdaki butona bas; sonra karar vermek istersen "Bekle" diyebilirsin.
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={handleResume} disabled={actionBusy} className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
              ▶ Devam Et
            </button>
            <button onClick={() => setWaitDismissed(true)} className="btn text-xs px-3 py-1.5">Bekle</button>
          </div>
        </div>
      )}
      {paused && !done && waitDismissed && (
        <button onClick={handleResume} className="btn btn-primary text-xs px-3 py-1.5">▶ Devam Et</button>
      )}

      {/* ── Canlı ekran kartları (üretim ilerleyişi) ──────────────── */}
      {screens.length > 0 && (
        <div>
          <div className="section-label mb-2">İşlenen Ekranlar · {screens.length}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
            {screens.map((s, i) => (
              <div key={i} className="glass rounded-lg px-3 py-2 flex items-center gap-2 fade-in">
                <span className={`text-sm flex-shrink-0 ${
                  s.status === "warn" ? "text-amber-500" : s.status === "skip" ? "text-fg3" : "text-green-500"
                }`}>
                  {s.status === "warn" ? "⚠" : s.status === "skip" ? "↺" : "✓"}
                </span>
                <span className="text-[12px] text-fg2 truncate" title={s.title}>{s.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Aktivite log'u (katlanabilir) ─────────────────────────── */}
      <div className="glass rounded-xl overflow-hidden">
        <button
          onClick={() => setLogOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface2/50 transition-colors"
        >
          <span className="section-label">Aktivite Günlüğü · {logs.length} satır</span>
          <span className={`chevron text-fg3 text-xs ${logOpen ? "open" : ""}`}>▶</span>
        </button>
        {logOpen && (
          <div ref={logRef} className="border-t border-line max-h-56 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed bg-app/40">
            {logs.map((line, i) => (
              <div key={i} className={
                line.startsWith("⚠") ? "text-amber-500"
                  : paused && i === logs.length - 1 ? "text-amber-400"
                  : "text-fg2"
              }>
                {line}
              </div>
            ))}
            {running && <div className="text-accent animate-pulse">▌</div>}
          </div>
        )}
      </div>

      {/* ── Terminal durumlar ─────────────────────────────────────── */}
      {done && !endedWithError && (
        <div className="glass rounded-xl px-4 py-3 flex items-center gap-2 border-l-2 border-l-green-500 fade-in">
          <span className="text-green-500 text-lg">✓</span>
          <span className="text-sm text-fg font-medium">Tamamlandı{effTotal > 0 ? ` — ${current}/${effTotal} ekran` : ""}</span>
        </div>
      )}
      {done && endedWithError && (
        <div className="glass rounded-xl px-4 py-3 text-[13px] text-fg2 border-l-2 border-l-red-500 fade-in">
          <div className="font-semibold text-fg mb-0.5">✕ Job tamamlanmadı</div>
          <div>
            {effTotal > 0
              ? `${current}/${effTotal} ekran üretildi. Tamamlanan dokümanlar Dökümanlar sayfasında. `
              : `Üretim sonlanmadan kesildi. `}
            Eksik ekranları yeniden üretmek için <strong>Geçmiş</strong> sayfasındaki
            "⟳ Eksikleri Üret" düğmesini kullanın — tamamlananlar yeniden ödenmez.
          </div>
        </div>
      )}
    </div>
  );
}
