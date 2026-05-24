import { useState, useEffect, useRef } from "react";

type Tab = "sources" | "confluence" | "swagger" | "documents" | "templates";

interface ConfluenceRef { id: string; url: string; title: string; spaceKey: string; syncedAt: string; wordCount: number; }
interface SwaggerRef { id: string; url: string; name: string; fetchedAt: string; endpointCount: number; }
interface DocumentRef { id: string; originalName: string; type: string; company?: string; description?: string; uploadedAt: string; wordCount: number; }
interface SourceRef { id: string; kind: "confluence-space" | "jira-project"; key: string; name: string; lastSync: string | null; itemCount: number; }

interface AllRefs {
  confluence: ConfluenceRef[];
  swagger: SwaggerRef[];
  documents: DocumentRef[];
}

export default function ReferencesPage() {
  const [tab, setTab] = useState<Tab>("sources");
  const [refs, setRefs] = useState<AllRefs>({ confluence: [], swagger: [], documents: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data sources (Confluence spaces / Jira projects)
  const [confSpaces, setConfSpaces] = useState<SourceRef[]>([]);
  const [jiraProjects, setJiraProjects] = useState<SourceRef[]>([]);
  const [atlassianConnected, setAtlassianConnected] = useState(true);

  // Confluence
  const [confUrl, setConfUrl] = useState("");

  // Swagger
  const [swagUrl, setSwagUrl] = useState("");
  const [swagName, setSwagName] = useState("");
  const [swagAuth, setSwagAuth] = useState("");
  const [swagInsecure, setSwagInsecure] = useState(false);

  // Upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<"reference" | "brd" | "template">("reference");
  const [docCompany, setDocCompany] = useState("");
  const [docDesc, setDocDesc] = useState("");

  async function load() {
    const r = await fetch("/api/references").then((x) => x.json()) as AllRefs;
    setRefs(r);
  }

  async function loadSources() {
    try {
      const s = await fetch("/api/sources").then((x) => x.json()) as {
        confluenceSpaces: SourceRef[];
        jiraProjects: SourceRef[];
        connected: boolean;
      };
      setConfSpaces(s.confluenceSpaces ?? []);
      setJiraProjects(s.jiraProjects ?? []);
      setAtlassianConnected(s.connected);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); loadSources(); }, []);

  async function fetchConfluence() {
    if (!confUrl.trim()) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/references/confluence/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DocAgent": "1" },
        body: JSON.stringify({ url: confUrl }),
      });
      if (!r.ok) throw new Error((await r.json() as { error: string }).error);
      setConfUrl("");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function fetchSwagger() {
    if (!swagUrl.trim()) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/references/swagger/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DocAgent": "1" },
        body: JSON.stringify({ url: swagUrl, name: swagName, authorization: swagAuth, insecure: swagInsecure }),
      });
      if (!r.ok) throw new Error((await r.json() as { error: string }).error);
      setSwagUrl(""); setSwagName(""); setSwagAuth("");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function uploadDoc(file: File, type: string) {
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", type);
      fd.append("company", docCompany);
      fd.append("description", docDesc);
      const r = await fetch("/api/references/documents/upload", { method: "POST", body: fd, headers: { "X-DocAgent": "1" } });
      if (!r.ok) throw new Error((await r.json() as { error: string }).error);
      setDocCompany(""); setDocDesc("");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function remove(type: "confluence" | "swagger" | "documents", id: string) {
    await fetch(`/api/references/${type}/${id}`, { method: "DELETE", headers: { "X-DocAgent": "1" } });
    await load();
  }

  async function addSource(kind: "confluence" | "jira", key: string, name: string) {
    setError(null);
    const r = await fetch(`/api/sources/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-DocAgent": "1" },
      body: JSON.stringify({ key, name }),
    });
    if (!r.ok) { setError((await r.json() as { error: string }).error); return; }
    await loadSources();
  }

  async function removeSource(id: string) {
    await fetch(`/api/sources/${id}`, { method: "DELETE", headers: { "X-DocAgent": "1" } });
    await loadSources();
  }

  async function syncSource(id: string): Promise<boolean> {
    setError(null);
    const r = await fetch(`/api/sources/${id}/sync`, { method: "POST", headers: { "X-DocAgent": "1" } });
    if (!r.ok) { setError((await r.json() as { error: string }).error); await loadSources(); return false; }
    await loadSources();
    await load();
    return true;
  }

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: "sources", label: "Veri Kaynakları", count: confSpaces.length + jiraProjects.length },
    { id: "confluence", label: "Confluence", count: refs.confluence.length },
    { id: "swagger", label: "Swagger / API", count: refs.swagger.length },
    { id: "documents", label: "Dökümanlar", count: refs.documents.filter(d => d.type !== "template").length },
    { id: "templates", label: "Şablonlar", count: refs.documents.filter(d => d.type === "template").length },
  ];

  return (
    <div className="p-7 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-gray-900">Referanslar</h1>
        <p className="text-[13px] text-gray-400 mt-0.5">
          Döküman oluştururken kullanılacak bağlam kaynakları: Confluence sayfaları, Swagger API'leri, BRD dökümanları ve şablonlar.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              tab === t.id
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Data Sources Tab */}
      {tab === "sources" && (
        <SourcesTab
          confSpaces={confSpaces}
          jiraProjects={jiraProjects}
          connected={atlassianConnected}
          onAdd={addSource}
          onRemove={removeSource}
          onSync={syncSource}
        />
      )}

      {/* Confluence Tab */}
      {tab === "confluence" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-[13px] font-semibold text-gray-700 mb-3">Confluence Sayfası Ekle</h3>
            <p className="text-[12px] text-gray-400 mb-3">
              Sayfa URL'sini girin. Agent döküman yazarken bu sayfanın içeriğini bağlam olarak kullanır.
            </p>
            <div className="flex gap-2">
              <input
                value={confUrl}
                onChange={(e) => setConfUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchConfluence()}
                placeholder="https://sirket.atlassian.net/wiki/spaces/DOCS/pages/12345/Sayfa-Adi"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
              />
              <button
                onClick={fetchConfluence}
                disabled={loading || !confUrl.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-[13px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {loading ? "Çekiliyor..." : "Ekle"}
              </button>
            </div>
          </div>

          {refs.confluence.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Sayfa</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Space</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Kelime</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Senkronize</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {refs.confluence.map((ref) => (
                    <tr key={ref.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800 truncate max-w-xs">{ref.title}</p>
                        <p className="text-[11px] text-gray-400 truncate max-w-xs">{ref.url}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{ref.spaceKey}</td>
                      <td className="px-4 py-3 text-gray-500">{ref.wordCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-400 text-[12px]">
                        {new Date(ref.syncedAt).toLocaleDateString("tr-TR")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => remove("confluence", ref.id)} className="text-red-400 hover:text-red-600 text-[12px]">Kaldır</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {refs.confluence.length === 0 && (
            <EmptyState text="Henüz Confluence sayfası eklenmedi." />
          )}
        </div>
      )}

      {/* Swagger Tab */}
      {tab === "swagger" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-[13px] font-semibold text-gray-700">BE Servisi Ekle / Güncelle (Swagger URL)</h3>
            <p className="text-[12px] text-gray-400 mt-0.5 mb-4">
              Swagger / OpenAPI spec URL'si. Endpoint listesi teknik döküman yazımında referans olarak kullanılır.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1">Servis Adı</label>
                <input
                  value={swagName}
                  onChange={(e) => setSwagName(e.target.value)}
                  placeholder="örn. payment-service, risk-api"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1">Swagger URL</label>
                <input
                  value={swagUrl}
                  onChange={(e) => setSwagUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchSwagger()}
                  placeholder="https://dev-servis.example.com/v3/api-docs"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-gray-700 mb-1">
                  Authorization <span className="text-gray-400 font-normal">(opsiyonel)</span>
                </label>
                <input
                  value={swagAuth}
                  onChange={(e) => setSwagAuth(e.target.value)}
                  placeholder="Bearer TOKEN"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Korumalı swagger için "Bearer …" veya "Basic …" şeklinde tam header değeri.
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={swagInsecure}
                  onChange={(e) => setSwagInsecure(e.target.checked)}
                  className="accent-blue-600"
                />
                <span className="text-[12px] text-gray-600">
                  SSL doğrulamasını atla
                  <span className="text-gray-400 ml-1">(self-signed / iç sertifikalı sunucular için)</span>
                </span>
              </label>

              <button
                onClick={fetchSwagger}
                disabled={loading || !swagUrl.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-[13px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2"
              >
                {loading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {loading ? "Çekiliyor..." : "Ekle / Güncelle"}
              </button>
            </div>
          </div>

          {refs.swagger.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Servis</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Endpoint</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Eklenme</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {refs.swagger.map((ref) => (
                    <tr key={ref.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{ref.name}</p>
                        <p className="text-[11px] text-gray-400 truncate max-w-xs">{ref.url}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                          {ref.endpointCount} endpoint
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-[12px]">
                        {new Date(ref.fetchedAt).toLocaleDateString("tr-TR")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => remove("swagger", ref.id)} className="text-red-400 hover:text-red-600 text-[12px]">Kaldır</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {refs.swagger.length === 0 && <EmptyState text="Henüz Swagger endpoint eklenmedi." />}
        </div>
      )}

      {/* Documents Tab */}
      {tab === "documents" && (
        <DocUploadTab
          refs={refs.documents.filter((d) => d.type !== "template")}
          docType={docType === "template" ? "reference" : docType}
          setDocType={(v) => setDocType(v as "brd" | "reference")}
          docCompany={docCompany}
          setDocCompany={setDocCompany}
          docDesc={docDesc}
          setDocDesc={setDocDesc}
          fileRef={fileRef}
          onUpload={(f, t) => uploadDoc(f, t)}
          onRemove={(id) => remove("documents", id)}
          loading={loading}
          isTemplate={false}
        />
      )}

      {/* Templates Tab */}
      {tab === "templates" && (
        <DocUploadTab
          refs={refs.documents.filter((d) => d.type === "template")}
          docType="template"
          setDocType={() => {}}
          docCompany={docCompany}
          setDocCompany={setDocCompany}
          docDesc={docDesc}
          setDocDesc={setDocDesc}
          fileRef={fileRef}
          onUpload={(f, t) => uploadDoc(f, t)}
          onRemove={(id) => remove("documents", id)}
          loading={loading}
          isTemplate={true}
        />
      )}
    </div>
  );
}

function DocUploadTab({
  refs, docType, setDocType, docCompany, setDocCompany, docDesc, setDocDesc,
  fileRef, onUpload, onRemove, loading, isTemplate,
}: {
  refs: DocumentRef[];
  docType: string;
  setDocType: (v: string) => void;
  docCompany: string; setDocCompany: (v: string) => void;
  docDesc: string; setDocDesc: (v: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (f: File, type: string) => void;
  onRemove: (id: string) => void;
  loading: boolean;
  isTemplate: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-[13px] font-semibold text-gray-700 mb-1">
          {isTemplate ? "Şablon Yükle" : "Referans Döküman Yükle"}
        </h3>
        <p className="text-[12px] text-gray-400 mb-4">
          {isTemplate
            ? "Farklı firmalardan örnek dökümanlar yükleyin. Anlatım dili ve yapısı çıktı üretiminde referans alınır."
            : "Word (.docx), Markdown (.md) veya metin (.txt) formatında BRD veya referans dökümanı yükleyin."}
        </p>

        <div className="space-y-3 mb-4">
          {!isTemplate && (
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">Döküman Tipi</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="reference">Genel Referans</option>
                <option value="brd">BRD (İş Gereksinimleri)</option>
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">
                {isTemplate ? "Firma / Kaynak" : "Kaynak (opsiyonel)"}
              </label>
              <input
                value={docCompany}
                onChange={(e) => setDocCompany(e.target.value)}
                placeholder={isTemplate ? "Firma Adı" : "ör: Proje X, Şirket Y"}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-600 mb-1">Açıklama (opsiyonel)</label>
              <input
                value={docDesc}
                onChange={(e) => setDocDesc(e.target.value)}
                placeholder="Kısa açıklama"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".docx,.md,.txt,.pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, docType); e.target.value = ""; }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 text-gray-500 text-[13px] rounded-lg hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 transition-colors w-full justify-center"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 11V3M5 6l3-3 3 3M2 13h12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {loading ? "Yükleniyor..." : "Dosya seç (.docx, .pdf, .md, .txt)"}
        </button>
      </div>

      {refs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Dosya</th>
                {isTemplate && <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Firma</th>}
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Kelime</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Yükleme</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {refs.map((ref) => (
                <tr key={ref.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{ref.originalName}</p>
                    {ref.description && <p className="text-[11px] text-gray-400">{ref.description}</p>}
                  </td>
                  {isTemplate && <td className="px-4 py-3 text-gray-500">{ref.company || "—"}</td>}
                  <td className="px-4 py-3 text-gray-500">{ref.wordCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-400 text-[12px]">
                    {new Date(ref.uploadedAt).toLocaleDateString("tr-TR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onRemove(ref.id)} className="text-red-400 hover:text-red-600 text-[12px]">Kaldır</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {refs.length === 0 && (
        <EmptyState text={isTemplate ? "Henüz şablon yüklenmedi." : "Henüz referans döküman yüklenmedi."} />
      )}
    </div>
  );
}

// ── Data Sources tab ───────────────────────────────────────────────
function SourcesTab({
  confSpaces, jiraProjects, connected, onAdd, onRemove, onSync,
}: {
  confSpaces: SourceRef[];
  jiraProjects: SourceRef[];
  connected: boolean;
  onAdd: (kind: "confluence" | "jira", key: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSync: (id: string) => Promise<boolean>;
}) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const allSources = [...confSpaces, ...jiraProjects];

  async function handleSync(id: string) {
    setSyncingId(id);
    try { await onSync(id); }
    finally { setSyncingId(null); }
  }

  async function handleSyncAll() {
    setSyncingAll(true);
    try {
      for (const s of allSources) {
        setSyncingId(s.id);
        await onSync(s.id);
      }
    } finally {
      setSyncingId(null);
      setSyncingAll(false);
    }
  }

  return (
    <div className="space-y-4">
      {!connected && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-[12px] text-amber-700">
          Atlassian bağlantısı yok. Confluence space ve Jira projelerini senkronize edebilmek için
          önce <span className="font-medium">Ayarlar</span> sayfasından OAuth ile bağlanın.
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[12px] text-gray-400">
          Confluence space veya Jira projesi ekleyin. Senkronizasyon, içindeki tüm sayfaları /
          issue'ları çekerek döküman üretiminde bağlam olarak kullanılır.
        </p>
        {allSources.length > 0 && (
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || !connected}
            className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white text-[12px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2"
          >
            {syncingAll && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {syncingAll ? "Senkronize ediliyor..." : "Tümünü Güncelle"}
          </button>
        )}
      </div>

      <SourceSection
        title="Confluence Spaces"
        itemLabel="sayfa"
        keyPlaceholder="Space Key (örn: DOCS, ~ugurcangir)"
        sources={confSpaces}
        connected={connected}
        syncingId={syncingId}
        onAdd={(key, name) => onAdd("confluence", key, name)}
        onRemove={onRemove}
        onSync={handleSync}
      />

      <SourceSection
        title="Jira Projeleri"
        itemLabel="issue"
        keyPlaceholder="Proje Key (örn: MBS)"
        uppercaseKey
        sources={jiraProjects}
        connected={connected}
        syncingId={syncingId}
        onAdd={(key, name) => onAdd("jira", key, name)}
        onRemove={onRemove}
        onSync={handleSync}
      />
    </div>
  );
}

function SourceSection({
  title, itemLabel, keyPlaceholder, uppercaseKey, sources, connected,
  syncingId, onAdd, onRemove, onSync,
}: {
  title: string;
  itemLabel: string;
  keyPlaceholder: string;
  uppercaseKey?: boolean;
  sources: SourceRef[];
  connected: boolean;
  syncingId: string | null;
  onAdd: (key: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onSync: (id: string) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await onAdd(key.trim(), name.trim());
      setKey(""); setName("");
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-[13px] font-semibold text-gray-700 mb-3">{title}</h3>

      {sources.length > 0 && (
        <div className="space-y-2 mb-3">
          {sources.map((s) => {
            const syncing = syncingId === s.id;
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-semibold text-gray-800">{s.key}</span>
                    {s.name && s.name !== s.key && (
                      <span className="text-[12px] text-gray-500 truncate">· {s.name}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {s.lastSync
                      ? `${new Date(s.lastSync).toLocaleString("tr-TR")} · ${s.itemCount} ${itemLabel}`
                      : "Henüz senkronize edilmedi"}
                  </p>
                </div>
                <button
                  onClick={() => onSync(s.id)}
                  disabled={syncing || !connected}
                  className="flex-shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1.5"
                >
                  {syncing && <span className="w-2.5 h-2.5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />}
                  {syncing ? "Çekiliyor..." : "Senkronize Et"}
                </button>
                <button
                  onClick={() => onRemove(s.id)}
                  disabled={syncing}
                  className="flex-shrink-0 text-red-400 hover:text-red-600 text-[11px] disabled:opacity-40"
                >
                  Kaldır
                </button>
              </div>
            );
          })}
        </div>
      )}

      {sources.length === 0 && (
        <p className="text-[12px] text-gray-400 mb-3">Henüz eklenmedi.</p>
      )}

      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(uppercaseKey ? e.target.value.toUpperCase() : e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={keyPlaceholder}
          className="w-48 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Açıklama (opsiyonel)"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
        />
        <button
          onClick={handleAdd}
          disabled={busy || !key.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-[13px] font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          Ekle
        </button>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-200 p-10 text-center">
      <p className="text-[13px] text-gray-400">{text}</p>
    </div>
  );
}
