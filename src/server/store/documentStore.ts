import fs from "fs";
import path from "path";

export type DocumentStatus = "draft" | "approved" | "published";

export interface StoredDocument {
  id: string;
  jobId: string;
  screenPath: string;
  screenTitle: string;
  screenshotPath: string;
  userManualContent: string;
  technicalDocContent: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  confluenceUrl?: string;
}

const DB_PATH = path.join(
  process.cwd(),
  "data",
  "db",
  "documents.json"
);

function ensureDir(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load(): StoredDocument[] {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(
    fs.readFileSync(DB_PATH, "utf-8")
  ) as StoredDocument[];
}

function save(docs: StoredDocument[]): void {
  ensureDir();
  fs.writeFileSync(
    DB_PATH,
    JSON.stringify(docs, null, 2)
  );
}

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
    patch: Partial<StoredDocument>
  ): StoredDocument | undefined {
    const docs = load();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx === -1) return undefined;
    const updated = {
      ...docs[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    } as StoredDocument;
    docs[idx] = updated;
    save(docs);
    return updated;
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
