import path from "path";
import fs from "fs";
import { writeJsonAtomic, readJsonSafe } from "./atomicJson";

export type DocumentStatus = "draft" | "approved" | "published";

/** Sürüm meta verisi — ana `documents.json`'da yalnız bu tutulur (hafif). */
export interface DocumentVersionMeta {
  id: string;
  savedAt: string;
  reason: "edit" | "regenerate" | "publish";
}

/** Tam sürüm — gövde (userManualContent) yalnız per-doküman sidecar
 *  dosyasında (`data/db/versions/<id>.json`) saklanır. */
export interface DocumentVersion extends DocumentVersionMeta {
  userManualContent: string;
}

export interface StoredDocument {
  id: string;
  jobId: string;
  screenPath: string;
  screenTitle: string;
  screenshotPath: string;
  userManualContent: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  confluenceUrl?: string;
  /** Yalnız sürüm META'sı (id/savedAt/reason). Sürüm GÖVDELERİ sidecar'da;
   *  içerik için `documentStore.getVersions(id)` kullan. */
  versions?: DocumentVersionMeta[];
  inputTokens?: number;
  outputTokens?: number;
  /** Cache'ten okunan input token (0.1× ücret). Maliyet hesabında ayrı. */
  cacheReadTokens?: number;
  /** Cache yaratımı input token (1.25× ücret). */
  cacheCreationTokens?: number;
  /** Artımlı üretim parmak izi (analiz+bağlam+üretim-config). Aynı parmak
   *  izli bir ekran yeniden üretime girerse üretim ATLANIR (0 token). */
  inputFingerprint?: string;
}

const DB_PATH = path.join(process.cwd(), "data", "db", "documents.json");
const VERSIONS_DIR = path.join(process.cwd(), "data", "db", "versions");

const MAX_VERSIONS = 20;

function load(): StoredDocument[] {
  return readJsonSafe<StoredDocument[]>(DB_PATH, []);
}

function save(docs: StoredDocument[]): void {
  writeJsonAtomic(DB_PATH, docs);
}

// ── Sürüm gövdeleri: per-doküman sidecar ────────────────────────────
// GEREKÇE: eskiden her doküman `versions[]` içinde son 20 sürümün TAM
// markdown'ını taşıyordu ve tek `documents.json` dosyası her create/update'te
// baştan yazılıyordu → ekran başına ~20× içerik şişmesi + O(n) yazım. Artık
// sürüm gövdeleri yalnız ilgili dokümanın sidecar dosyasına yazılır; ana
// `documents.json` yalnız güncel içerik + hafif sürüm meta'sı tutar.
function versionsPath(id: string): string {
  return path.join(VERSIONS_DIR, `${id}.json`);
}

function loadVersions(id: string): DocumentVersion[] {
  return readJsonSafe<DocumentVersion[]>(versionsPath(id), []);
}

function saveVersions(id: string, versions: DocumentVersion[]): void {
  writeJsonAtomic(versionsPath(id), versions);
}

function deleteVersions(id: string): void {
  try { fs.rmSync(versionsPath(id), { force: true }); } catch { /* best effort */ }
}

function toMeta(v: DocumentVersion): DocumentVersionMeta {
  return { id: v.id, savedAt: v.savedAt, reason: v.reason };
}

// ── Bir kerelik migrasyon: eski satır-içi sürüm gövdelerini sidecar'a taşı ──
// Eski `documents.json` sürüm içeriğini inline tutuyordu. Sunucu açılışında
// bir kez: içerik taşıyan sürümleri sidecar'a yaz, ana dosyada meta'ya indir.
// Migrasyon sonrası inline içerik kalmadığından sonraki açılışlarda no-op.
(function migrateInlineVersions(): void {
  try {
    const docs = load();
    let changed = false;
    for (const d of docs) {
      const vs = (d.versions ?? []) as Array<DocumentVersionMeta & { userManualContent?: string }>;
      const hasInline = vs.some((v) => typeof v.userManualContent === "string" && v.userManualContent.length > 0);
      if (!hasInline) continue;
      const full: DocumentVersion[] = vs
        .map((v) => ({ id: v.id, savedAt: v.savedAt, reason: v.reason, userManualContent: v.userManualContent ?? "" }))
        .slice(-MAX_VERSIONS);
      saveVersions(d.id, full);
      d.versions = full.map(toMeta);
      changed = true;
    }
    if (changed) {
      save(docs);
      console.log("[documentStore] sürüm gövdeleri sidecar'a taşındı (bir kerelik migrasyon)");
    }
  } catch (err) {
    console.warn("[documentStore] sürüm migrasyonu atlandı:", (err as Error).message);
  }
})();

// NOT: Tüm mutasyonlar (create/update/delete/restoreVersion) **tamamen
// senkron** kalmalı. Node tek-thread'li; load → modify → save zinciri
// içinde await olmadığı sürece event loop araya giremez ve concurrent
// worker'lar arasında race oluşmaz (documentationJob CONCURRENCY=3'te
// güvenli). Bu fonksiyonların ortasına bir `await` eklenirse açık bir
// in-memory mutex (örn. `p-limit(1)`) zorunlu olur.
export const documentStore = {
  getAll(): StoredDocument[] {
    return load();
  },

  getById(id: string): StoredDocument | undefined {
    return load().find((d) => d.id === id);
  },

  getByScreenPath(screenPath: string): StoredDocument[] {
    return load().filter((d) => d.screenPath === screenPath);
  },

  /** Bir ekranın EN GÜNCEL dokümanı (artımlı üretim skip kontrolü için). */
  getLatestByScreenPath(screenPath: string): StoredDocument | undefined {
    return load()
      .filter((d) => d.screenPath === screenPath)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  },

  getByJobId(jobId: string): StoredDocument[] {
    return load().filter((d) => d.jobId === jobId);
  },

  /** Bir dokümanın tam sürüm listesi (gövdeler dahil) — sidecar'dan okur. */
  getVersions(id: string): DocumentVersion[] {
    return loadVersions(id);
  },

  create(doc: StoredDocument): void {
    const docs = load();
    // Yeni doküman normalde sürümsüz gelir; olası inline gövdeyi sidecar'a al.
    const incoming = (doc.versions ?? []) as Array<DocumentVersionMeta & { userManualContent?: string }>;
    if (incoming.some((v) => v.userManualContent)) {
      const full = incoming.map((v) => ({
        id: v.id, savedAt: v.savedAt, reason: v.reason, userManualContent: v.userManualContent ?? "",
      })).slice(-MAX_VERSIONS);
      saveVersions(doc.id, full);
      doc.versions = full.map(toMeta);
    }
    docs.push(doc);
    save(docs);
  },

  update(
    id: string,
    patch: Partial<StoredDocument>,
    versionReason: DocumentVersion["reason"] = "edit"
  ): StoredDocument | undefined {
    const docs = load();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx === -1) return undefined;
    const current = docs[idx] as StoredDocument;

    // İçerik gerçekten değişiyorsa, MEVCUT içeriği bir sürüm olarak sidecar'a al.
    const contentChanged =
      patch.userManualContent !== undefined &&
      patch.userManualContent !== current.userManualContent;

    let versionMeta = current.versions ?? [];
    if (contentChanged) {
      const bodies = loadVersions(id);
      bodies.push({
        id: `v${bodies.length + 1}_${Date.now()}`,
        savedAt: new Date().toISOString(),
        reason: versionReason,
        userManualContent: current.userManualContent,
      });
      const trimmed = bodies.slice(-MAX_VERSIONS);
      saveVersions(id, trimmed);
      versionMeta = trimmed.map(toMeta);
    }

    const updated = {
      ...current,
      ...patch,
      versions: versionMeta,
      updatedAt: new Date().toISOString(),
    } as StoredDocument;
    docs[idx] = updated;
    save(docs);
    return updated;
  },

  restoreVersion(id: string, versionId: string): StoredDocument | undefined {
    const docs = load();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx === -1) return undefined;
    const doc = docs[idx] as StoredDocument;

    const bodies = loadVersions(id);
    const version = bodies.find((v) => v.id === versionId);
    if (!version) return undefined;

    // Geri yüklemeden önce mevcut içeriği yeni bir sürüm olarak sakla.
    bodies.push({
      id: `v${bodies.length + 1}_${Date.now()}`,
      savedAt: new Date().toISOString(),
      reason: "edit",
      userManualContent: doc.userManualContent,
    });
    const trimmed = bodies.slice(-MAX_VERSIONS);
    saveVersions(id, trimmed);

    const restored = {
      ...doc,
      userManualContent: version.userManualContent,
      versions: trimmed.map(toMeta),
      updatedAt: new Date().toISOString(),
    } as StoredDocument;
    docs[idx] = restored;
    save(docs);
    return restored;
  },

  delete(id: string): void {
    const docs = load().filter((d) => d.id !== id);
    save(docs);
    deleteVersions(id);
  },

  // Group documents by screenPath for the library view
  groupByScreen(): Record<string, StoredDocument[]> {
    const all = load();
    const groups: Record<string, StoredDocument[]> = {};
    for (const doc of all) {
      if (!groups[doc.screenPath]) {
        groups[doc.screenPath] = [];
      }
      (groups[doc.screenPath] as StoredDocument[]).push(doc);
    }
    return groups;
  },
};
