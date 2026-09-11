import { useState, useEffect } from "react";
import { discovery, jobs, jobControl } from "../lib/api";
import ProgressView from "../components/ProgressView";
import { useToast } from "../components/Toast";
import type { StoredScreen } from "../types";

interface DiscoveryPageProps {
  /** Documentation job started (after Döküman Oluştur) */
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
  const toast = useToast();
  const [screens, setScreens] = useState<StoredScreen[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraUrl, setExtraUrl] = useState("");
  const [extraUrls, setExtraUrls] = useState<string[]>([]);
  const [discoveryJobId, setDiscoveryJobId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [docJobLoading, setDocJobLoading] = useState(false);
  const [forceRegen, setForceRegen] = useState(false);
  const [appUrl, setAppUrl] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [keywords, setKeywords] = useState(() => localStorage.getItem("ctx_keywords") ?? "");
  const [confluencePages, setConfluencePages] = useState(() => localStorage.getItem("ctx_confluence_pages") ?? "");
  const [contextSaved, setContextSaved] = useState(false);

  function saveContext() {
    localStorage.setItem("ctx_keywords", keywords);
    localStorage.setItem("ctx_confluence_pages", confluencePages);
    setContextSaved(true);
    setTimeout(() => setContextSaved(false), 2000);
  }

  const activeStep =
    docJobLoading ? 4
    : screens.length > 0 && selected.size > 0 ? 3
    : screens.length > 0 ? 3
    : discovering ? 2
    : appUrl ? 2
    : 1;

  useEffect(() => {
    discovery.getScreens().then(setScreens).catch(() => {});
    const loadConfig = () =>
      fetch("/api/settings")
        .then((r) => r.json())
        .then((d: { values: { APP_BASE_URL?: string } }) => setAppUrl(d.values?.APP_BASE_URL ?? ""))
        .catch(() => {});
    loadConfig();
    const onFocus = () => loadConfig();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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

  function handleDiscoveryError(message: string) {
    setDiscovering(false);
    setDiscoveryJobId(null);
    toast.show(`Keşif başarısız: ${message}`, "error");
  }

  function handleDiscoveryComplete() {
    setDiscovering(false);
    setDiscoveryJobId(null);
    discovery.getScreens().then((s) => {
      setScreens(s);
      setSelected(new Set(s.map((sc) => sc.path)));
      const totalStates = s.reduce((sum, sc) => sum + ((sc as { states?: unknown[] }).states?.length ?? 0), 0);
      toast.show(`✓ Keşif tamamlandı — ${s.length} ekran, ${totalStates} etkileşim state'i yakalandı`, "success");
    });
  }

  function toggleScreen(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  async function deleteScreen(path: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Bu keşfedilen ekranı silmek istiyor musunuz?")) return;
    try {
      await discovery.deleteScreen(path);
      setScreens((prev) => prev.filter((s) => s.path !== path));
      setSelected((prev) => { const n = new Set(prev); n.delete(path); return n; });
      toast.show("Ekran silindi", "success");
    } catch (err) {
      toast.show((err as Error).message, "error");
    }
  }

  async function clearAllScreens() {
    if (!confirm(`Tüm ${screens.length} keşfedilen ekran silinecek. Emin misiniz?`)) return;
    try {
      await discovery.clearScreens();
      setScreens([]);
      setSelected(new Set());
      toast.show("Tüm ekranlar temizlendi", "success");
    } catch (err) {
      toast.show((err as Error).message, "error");
    }
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
      const { jobId } = await jobs.start(Array.from(selected), forceRegen);
      onJobStarted(jobId);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDocJobLoading(false);
    }
  }

  return (
    <div className="p-7 fade-in">
      <div className="mb-5">
        <h1 className="text-[23px] font-semibold text-fg tracking-tight">Ekran Keşfi</h1>
        <p className="text-[13px] text-fg3 mt-0.5">
          Uygulamayı otomatik tara, ekranları seç ve Claude ile Türkçe kullanıcı kılavuzu üret.
        </p>
      </div>

      {/* İş akışı ekranı: SOLDA kurulum (dar/okunur), SAĞDA sonuç (galeri) */}
      <div className="grid xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] gap-5 items-start">

        {/* ── SOL: Kurulum ─────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Dikey adım göstergesi */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[12px] font-semibold text-fg2 uppercase tracking-wide">İş Akışı</h2>
              <span className="text-[10px] font-mono text-fg3 bg-surface2 border border-line px-2 py-0.5 rounded-full">{STEPS.length} ADIM</span>
            </div>
            <div>
              {STEPS.map((step, i) => {
                const isActive = activeStep === step.n;
                const isDone = activeStep > step.n;
                const last = i === STEPS.length - 1;
                return (
                  <div key={step.n} className="flex gap-3 relative">
                    {!last && <span className={`absolute left-[11px] top-6 -bottom-0 w-px ${isDone ? "bg-accent/50" : "bg-line"}`} />}
                    <div className={`w-[23px] h-[23px] rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 z-10 ${
                      isActive ? "bg-accent text-on-accent shadow-[0_0_10px_rgba(45,212,191,.55)]"
                      : isDone ? "bg-green-500 text-white"
                      : "bg-surface2 text-fg3 border border-line"
                    }`}>{isDone ? "✓" : step.n}</div>
                    <div className={last ? "" : "pb-5"}>
                      <p className={`text-[13px] leading-[23px] ${isActive ? "text-fg font-semibold" : isDone ? "text-fg2" : "text-fg3"}`}>{step.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Hedef uygulama + başlat */}
          <div className="glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-fg">Hedef Uygulama</h3>
              {appUrl ? (
                <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✓ hazır</span>
              ) : (
                <button onClick={() => window.dispatchEvent(new CustomEvent("navigate", { detail: "settings" }))} className="text-[12px] text-accent hover:underline">Ayarları aç →</button>
              )}
            </div>

            {appUrl ? (
              <div className="mb-4 flex items-center gap-2 bg-surface2 border border-line rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-[12px] text-fg2 truncate font-mono">{appUrl}</span>
              </div>
            ) : (
              <p className="mb-4 text-[12px] text-fg3">Önce Ayarlar'dan hedef uygulama URL'sini ve giriş bilgilerini girin.</p>
            )}

            <label className="block text-[12px] font-medium text-fg2 mb-1.5">Ek URL <span className="text-fg3 font-normal">(opsiyonel)</span></label>
            <div className="flex gap-2">
              <input type="url" value={extraUrl} onChange={(e) => setExtraUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addExtraUrl()}
                placeholder="https://uygulama.com/ekran-path"
                className="flex-1 min-w-0 border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent bg-surface2" />
              <button onClick={addExtraUrl} className="px-3 py-2 border border-line text-fg2 text-[13px] rounded-lg hover:bg-surface2">Ekle</button>
            </div>
            {extraUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {extraUrls.map((u) => (
                  <span key={u} className="inline-flex items-center gap-1 bg-accent-soft text-accent text-[11px] px-2 py-0.5 rounded-full border border-accent/30">
                    <span className="truncate max-w-[180px]">{u}</span>
                    <button onClick={() => setExtraUrls((p) => p.filter((x) => x !== u))} className="hover:opacity-70">×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={startDiscovery} disabled={discovering || !appUrl}
                className="flex items-center gap-2 btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                {discovering && <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />}
                {discovering ? "Keşfediliyor…" : "Başlat"}
              </button>
              {deepAnalysis && (
                <button onClick={startDiscovery} disabled={discovering || !appUrl}
                  className="btn btn-outline !border-violet-400 !text-violet-500 disabled:opacity-40">Derin Analizle Başlat</button>
              )}
            </div>
          </div>

          {/* Bağlam filtresi (katlanır) */}
          <div className="glass rounded-xl">
            <button onClick={() => setContextOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-fg3"><path d="M2 4h12M4 8h8M6 12h4" /></svg>
                <span className="text-[13px] font-semibold text-fg">Bağlam Filtresi</span>
              </div>
              <div className="flex items-center gap-2">
                {(keywords || confluencePages) && <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">aktif</span>}
                <svg className={`text-fg3 transition-transform ${contextOpen ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4" /></svg>
              </div>
            </button>
            {contextOpen && (
              <div className="px-5 pb-5 border-t border-line pt-4 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold text-fg3 tracking-wider uppercase mb-1">Anahtar Kelimeler</p>
                  <p className="text-[11px] text-fg3 mb-2">Confluence sayfalarında ve Jira task'larında bu kelimeleri ara</p>
                  <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ör: ticket management, kullanıcı yönetimi"
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent bg-surface2" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-fg3 tracking-wider uppercase mb-1">Confluence Sayfa Adları</p>
                  <p className="text-[11px] text-fg3 mb-2">Boş bırakılırsa içerik bazlı aranır</p>
                  <input type="text" value={confluencePages} onChange={(e) => setConfluencePages(e.target.value)} placeholder="ticket management"
                    className="w-full border border-line rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-accent bg-surface2" />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={saveContext} className="btn btn-primary btn-sm">Kaydet</button>
                  <button onClick={() => { setKeywords(""); setConfluencePages(""); localStorage.removeItem("ctx_keywords"); localStorage.removeItem("ctx_confluence_pages"); }} className="btn btn-outline btn-sm">Temizle</button>
                  {contextSaved && <span className="text-[12px] text-green-600 ml-1">✓ Kaydedildi</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── SAĞ: Sonuç (galeri / ilerleme / boş durum) ───────── */}
        <div className="min-w-0 space-y-5">
          {discovering && discoveryJobId ? (
            <div className="glass rounded-xl p-5">
              <p className="text-[10px] font-semibold text-fg3 tracking-wider uppercase mb-1">İlerleme</p>
              <h3 className="text-[14px] font-semibold text-fg mb-4">Ekranlar Keşfediliyor</h3>
              <ProgressView
                streamUrl={`/api/discovery/${discoveryJobId}/stream`}
                onComplete={handleDiscoveryComplete}
                onError={handleDiscoveryError}
                onPause={async () => { await jobControl.pause(discoveryJobId); }}
                onResume={async () => { await jobControl.resume(discoveryJobId); }}
                onCancel={async () => { if (!confirm("Keşfi tamamen iptal etmek istiyor musun?")) return; await jobControl.cancel(discoveryJobId); setDiscovering(false); }}
              />
            </div>
          ) : screens.length > 0 ? (
            <div className="glass rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-[14px] font-semibold text-fg">Keşfedilen Ekranlar</h3>
                  <p className="text-[12px] text-fg3 mt-0.5">{screens.length} ekran · {selected.size} seçili</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={() => selected.size === screens.length ? setSelected(new Set()) : setSelected(new Set(screens.map((s) => s.path)))} className="text-[12px] text-accent hover:underline">
                    {selected.size === screens.length ? "Seçimi Kaldır" : "Tümünü Seç"}
                  </button>
                  <button onClick={clearAllScreens} className="text-[12px] text-red-500 hover:text-red-600" title="Tüm keşfedilen ekranları sil">Tümünü Temizle</button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                {screens.map((screen) => (
                  <label key={screen.path}
                    className={`group relative flex gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selected.has(screen.path) ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong hover:bg-surface2/60"}`}>
                    <button onClick={(e) => deleteScreen(screen.path, e)} title="Ekranı sil"
                      className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-md flex items-center justify-center text-fg3 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                    <input type="checkbox" checked={selected.has(screen.path)} onChange={() => toggleScreen(screen.path)} className="mt-1 flex-shrink-0 accent-blue-600" />
                    <img src={`/screenshots/${screen.screenshotPath.split("/").pop()}`} alt=""
                      className="w-20 h-12 object-cover rounded border border-line flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg truncate">{screen.title || screen.path}</p>
                      <p className="text-[11px] text-fg3 truncate mt-0.5 font-mono">{screen.path}</p>
                      <div className="flex gap-1.5 mt-1">
                        <span className="text-[10px] text-fg3 bg-surface2 px-1.5 py-0.5 rounded">depth {screen.depth}</span>
                        {(screen.states?.length ?? 0) > 0 && (
                          <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">+{screen.states?.length} state</span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 mt-4 border-t border-line">
                <div className="min-w-0">
                  <p className="text-[13px] text-fg2">
                    {selected.size === 0 ? "Döküman oluşturmak için en az bir ekran seçin"
                      : `${selected.size} ekran için Claude${deepAnalysis ? " (Derin Analiz)" : ""} ile döküman oluşturulacak`}
                  </p>
                  <label className="mt-1.5 flex items-center gap-2 text-[12px] text-fg3 cursor-pointer select-none">
                    <input type="checkbox" checked={forceRegen} onChange={(e) => setForceRegen(e.target.checked)} className="accent-blue-600" />
                    Değişmeyenleri de yeniden üret <span className="text-fg3">— kapalıyken atlanır (0 token)</span>
                  </label>
                </div>
                <button onClick={startDocumentation} disabled={selected.size === 0 || docJobLoading}
                  className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white text-[13px] font-medium rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {docJobLoading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {docJobLoading ? "Başlatılıyor…" : "Döküman Oluştur →"}
                </button>
              </div>
            </div>
          ) : (
            <div className="glass rounded-xl p-8 flex flex-col items-center justify-center text-center min-h-[320px]">
              <div className="orb w-10 h-10 mb-4 opacity-70" />
              <p className="text-[14px] font-semibold text-fg">Keşfedilen ekranlar burada listelenecek</p>
              <p className="text-[12px] text-fg3 mt-1.5 max-w-[360px]">
                Soldaki <b className="text-fg2">Başlat</b> ile hedef uygulamayı tara; bulunan ekranları seçip Claude ile Türkçe kılavuz üret.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
