import { useState, useEffect, useCallback } from "react";
import { documents as docsApi, exportApi } from "../lib/api";
import type { StoredDocument } from "../types";
import StatusBadge from "../components/StatusBadge";
import MarkdownEditor from "../components/MarkdownEditor";
import PublishModal from "../components/PublishModal";
import VersionHistoryPanel from "../components/VersionHistoryPanel";
import SectionRegenerateModal from "../components/SectionRegenerateModal";
import { useToast } from "../components/Toast";

type DocTab = "userManual" | "technicalDoc";

export default function DocumentsPage() {
  const [grouped, setGrouped] = useState<
    Record<string, StoredDocument[]>
  >({});
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DocTab>("userManual");
  const [editContent, setEditContent] = useState<{
    userManualContent: string;
    technicalDocContent: string;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishModalIds, setPublishModalIds] = useState<
    string[] | null
  >(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [versionPanelDocId, setVersionPanelDocId] = useState<string | null>(null);
  const [regenModal, setRegenModal] = useState<{ docId: string; target: DocTab } | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const g = await docsApi.getGrouped();
    setGrouped(g);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeDoc = activeDocId
    ? Object.values(grouped)
        .flat()
        .find((d) => d.id === activeDocId) ?? null
    : null;

  function openDoc(doc: StoredDocument) {
    setActiveDocId(doc.id);
    setEditContent({
      userManualContent: doc.userManualContent,
      technicalDocContent: doc.technicalDocContent,
    });
    setDirty(false);
    setActiveTab("userManual");
  }

  type EditContentKey = "userManualContent" | "technicalDocContent";

  function handleContentChange(
    field: EditContentKey,
    value: string
  ) {
    setEditContent((prev) =>
      prev ? { ...prev, [field]: value } : prev
    );
    setDirty(true);
  }

  async function save() {
    if (!activeDocId || !editContent) return;
    setSaving(true);
    try {
      await docsApi.update(activeDocId, editContent);
      setDirty(false);
      await load();
      toast.show("Döküman kaydedildi", "success");
    } catch (e) {
      toast.show(`Kaydetme hatası: ${(e as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function approve(id: string) {
    await docsApi.setStatus(id, "approved");
    await load();
    toast.show("Döküman onaylandı", "success");
  }

  async function setDraft(id: string) {
    await docsApi.setStatus(id, "draft");
    await load();
    toast.show("Taslağa alındı", "info");
  }

  async function deleteDoc(id: string) {
    if (!confirm("Bu dökümanı silmek istiyor musunuz?")) return;
    await docsApi.delete(id);
    if (activeDocId === id) setActiveDocId(null);
    await load();
    toast.show("Döküman silindi", "info");
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allDocs = Object.values(grouped).flat();

  const filteredGroups = Object.entries(grouped).filter(
    ([key, docs]) =>
      !search ||
      key.toLowerCase().includes(search.toLowerCase()) ||
      docs.some((d) =>
        d.screenTitle.toLowerCase().includes(search.toLowerCase())
      )
  );

  const approvedCount = allDocs.filter(
    (d) => d.status === "approved"
  ).length;

  return (
    <div className="flex h-[calc(100vh-2.75rem)] overflow-hidden">
      {/* Left panel: document list */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Dökümanlar
            </h2>
            <span className="text-xs text-gray-400">
              {allDocs.length} toplam
            </span>
          </div>
          <input
            type="text"
            placeholder="Ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
            <span className="text-xs text-blue-700 font-medium">
              {selectedIds.size} seçili
            </span>
            <button
              onClick={() =>
                setPublishModalIds(Array.from(selectedIds))
              }
              className="text-xs text-blue-600 hover:text-blue-800 ml-auto"
            >
              Yayınla →
            </button>
            <button
              onClick={() => exportApi.downloadDocx(Array.from(selectedIds), "Seçili Dökümanlar")}
              className="text-xs text-blue-600 hover:text-blue-800"
            >Word</button>
            <button
              onClick={() => exportApi.downloadPdf(Array.from(selectedIds), "Seçili Dökümanlar")}
              className="text-xs text-blue-600 hover:text-blue-800"
            >PDF</button>
            <button
              onClick={() => exportApi.downloadZip(Array.from(selectedIds), "Seçili Dökümanlar")}
              className="text-xs text-blue-600 hover:text-blue-800"
            >ZIP</button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filteredGroups.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              {allDocs.length === 0
                ? "Henüz döküman yok. Ekran Keşfi ile başlayın."
                : "Arama sonucu bulunamadı."}
            </div>
          ) : (
            filteredGroups.map(([screenPath, docs]) => (
              <div
                key={screenPath}
                className="border-b border-gray-100"
              >
                <div className="px-4 py-2 bg-gray-50">
                  <p className="text-xs font-medium text-gray-500 truncate">
                    {docs[0]?.screenTitle || screenPath}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {screenPath}
                  </p>
                </div>

                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                      activeDocId === doc.id
                        ? "bg-blue-50 border-l-2 border-blue-500"
                        : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-shrink-0"
                    />
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => openDoc(doc)}
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge status={doc.status} />
                        <span className="text-xs text-gray-400">
                          {new Date(doc.createdAt).toLocaleDateString(
                            "tr-TR"
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        Job: {doc.jobId.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Bottom stats */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {approvedCount} onaylı / {allDocs.length} toplam
            </span>
            {approvedCount > 0 && (
              <button
                onClick={() => {
                  const approved = allDocs
                    .filter((d) => d.status === "approved")
                    .map((d) => d.id);
                  setPublishModalIds(approved);
                }}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Onaylıları Yayınla
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Right panel: document editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeDoc && editContent ? (
          <>
            {/* Header */}
            <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center gap-4">
              {/* Screenshot */}
              <img
                src={`/screenshots/${activeDoc.screenshotPath.split("/").pop()}`}
                alt={activeDoc.screenTitle}
                className="h-10 w-16 object-cover rounded border border-gray-200"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-gray-900 truncate">
                  {activeDoc.screenTitle}
                </h2>
                <p className="text-xs text-gray-400">
                  {activeDoc.screenPath}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge status={activeDoc.status} />

                {dirty && (
                  <button
                    onClick={save}
                    disabled={saving}
                    className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded-lg hover:bg-gray-900 disabled:opacity-60"
                  >
                    {saving ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                )}

                {activeDoc.status === "draft" && (
                  <button
                    onClick={() => approve(activeDoc.id)}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                  >
                    ✓ Onayla
                  </button>
                )}

                {activeDoc.status === "approved" && (
                  <>
                    <button
                      onClick={() => setDraft(activeDoc.id)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200"
                    >
                      Taslağa Al
                    </button>
                    <button
                      onClick={() =>
                        setPublishModalIds([activeDoc.id])
                      }
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
                    >
                      Confluence'a Yayınla
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setExportMenuOpen((v) => !v)}
                        className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 flex items-center gap-1"
                      >
                        İndir ▾
                      </button>
                      {exportMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[160px]">
                          {[
                            { label: "Word (.docx)", fn: () => exportApi.downloadDocx([activeDoc.id], activeDoc.screenTitle) },
                            { label: "PDF", fn: () => exportApi.downloadPdf([activeDoc.id], activeDoc.screenTitle) },
                            { label: "Markdown", fn: () => exportApi.downloadMarkdown([activeDoc.id], activeDoc.screenTitle) },
                            { label: "ZIP (tüm dosyalar)", fn: () => exportApi.downloadZip([activeDoc.id], activeDoc.screenTitle) },
                          ].map((opt) => (
                            <button
                              key={opt.label}
                              onClick={() => { setExportMenuOpen(false); opt.fn().catch((e: Error) => toast.show(e.message, "error")); }}
                              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                <button
                  onClick={() => setRegenModal({ docId: activeDoc.id, target: activeTab })}
                  className="px-3 py-1.5 bg-violet-100 text-violet-700 text-xs rounded-lg hover:bg-violet-200"
                  title="Bir bölümü yeniden üret"
                >
                  ✨ Bölüm Üret
                </button>

                {(activeDoc.versions?.length ?? 0) > 0 && (
                  <button
                    onClick={() => setVersionPanelDocId(activeDoc.id)}
                    className="px-3 py-1.5 text-gray-600 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    Geçmiş ({activeDoc.versions?.length})
                  </button>
                )}

                <button
                  onClick={() => deleteDoc(activeDoc.id)}
                  className="px-3 py-1.5 text-red-500 text-xs hover:text-red-700"
                >
                  Sil
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-white">
              <button
                onClick={() => setActiveTab("userManual")}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "userManual"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Kullanıcı Kılavuzu
              </button>
              <button
                onClick={() => setActiveTab("technicalDoc")}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "technicalDoc"
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                Teknik Döküman
              </button>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-hidden">
              {activeTab === "userManual" ? (
                <MarkdownEditor
                  value={editContent.userManualContent}
                  onChange={(v) =>
                    handleContentChange("userManualContent", v)
                  }
                  readOnly={activeDoc.status === "published"}
                />
              ) : (
                <MarkdownEditor
                  value={editContent.technicalDocContent}
                  onChange={(v) =>
                    handleContentChange("technicalDocContent", v)
                  }
                  readOnly={activeDoc.status === "published"}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-4xl mb-3">📄</p>
              <p className="text-sm">
                Sol panelden bir döküman seçin
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Publish modal */}
      {publishModalIds && (
        <PublishModal
          documentIds={publishModalIds}
          onClose={() => setPublishModalIds(null)}
          onPublished={() => {
            setPublishModalIds(null);
            load();
            toast.show("Confluence'a yayınlandı", "success");
          }}
        />
      )}

      {/* Version history panel */}
      {versionPanelDocId && (
        <VersionHistoryPanel
          documentId={versionPanelDocId}
          onClose={() => setVersionPanelDocId(null)}
          onRestored={() => {
            setVersionPanelDocId(null);
            load();
            toast.show("Önceki versiyon geri yüklendi", "success");
          }}
        />
      )}

      {/* Section regenerate modal */}
      {regenModal && (
        <SectionRegenerateModal
          documentId={regenModal.docId}
          target={regenModal.target}
          onClose={() => setRegenModal(null)}
          onDone={() => {
            setRegenModal(null);
            load().then(() => {
              if (activeDoc) openDoc(activeDoc);
            });
            toast.show("Bölüm yeniden üretildi", "success");
          }}
        />
      )}
    </div>
  );
}
