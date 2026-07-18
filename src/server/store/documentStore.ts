import path from "path";
import { writeJsonAtomic, readJsonSafe } from "./atomicJson";

export type DocumentStatus = "draft" | "approved" | "published";

export interface DocumentVersion {
  id: string;
  savedAt: string;
  reason: "edit" | "regenerate" | "publish";
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
  versions?: DocumentVersion[];
  inputTokens?: number;
  outputTokens?: number;
  /** Cache'ten okunan input token (0.1× ücret). Maliyet hesabında ayrı. */
  cacheReadTokens?: number;
  /** Cache yaratımı input token (1.25× ücret). */
  cacheCreationTokens?: number;
}

const DB_PATH = path.join(
  process.cwd(),
  "data",
  "db",
  "documents.json"
);

function load(): StoredDocument[] {
  return readJsonSafe<StoredDocument[]>(DB_PATH, []);
}

function save(docs: StoredDocument[]): void {
  writeJsonAtomic(DB_PATH, docs);
}

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

  getByJobId(jobId: string): StoredDocument[] {
    return load().filter((d) => d.jobId === jobId);
  },

  create(doc: StoredDocument): void {
    const docs = load();
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

    // Snapshot current state before mutating, if content actually changes
    const contentChanged =
      patch.userManualContent !== undefined &&
      patch.userManualContent !== current.userManualContent;

    const versions = current.versions ?? [];
    if (contentChanged) {
      versions.push({
        id: `v${versions.length + 1}_${Date.now()}`,
        savedAt: new Date().toISOString(),
        reason: versionReason,
        userManualContent: current.userManualContent,
      });
    }

    const updated = {
      ...current,
      ...patch,
      versions: versions.slice(-20), // keep last 20
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
    const version = doc.versions?.find((v) => v.id === versionId);
    if (!version) return undefined;

    // Save current as a new version before restoring
    const versions = [
      ...(doc.versions ?? []),
      {
        id: `v${(doc.versions?.length ?? 0) + 1}_${Date.now()}`,
        savedAt: new Date().toISOString(),
        reason: "edit" as const,
        userManualContent: doc.userManualContent,
      },
    ];

    const restored = {
      ...doc,
      userManualContent: version.userManualContent,
      versions: versions.slice(-20),
      updatedAt: new Date().toISOString(),
    };
    docs[idx] = restored;
    save(docs);
    return restored;
  },

  delete(id: string): void {
    const docs = load().filter((d) => d.id !== id);
    save(docs);
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
