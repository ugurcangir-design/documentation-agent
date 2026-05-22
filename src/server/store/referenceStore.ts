import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

const DB_PATH = path.join(process.cwd(), "data", "db", "references.json");

export interface ConfluenceRef {
  id: string;
  url: string;
  pageId: string;
  title: string;
  spaceKey: string;
  contentFile: string;
  syncedAt: string;
  wordCount: number;
}

export interface SwaggerRef {
  id: string;
  url: string;
  name: string;
  fetchedAt: string;
  endpointCount: number;
  specFile: string;
}

export interface DocumentRef {
  id: string;
  filename: string;
  originalName: string;
  type: "brd" | "reference" | "template";
  company?: string;
  description?: string;
  uploadedAt: string;
  contentFile: string;
  wordCount: number;
}

/**
 * A registered data source — a whole Confluence space or a whole Jira
 * project. Unlike a single Confluence page, a source is *synced*: the
 * sync pulls every page / issue and materialises them as references.
 */
export interface SourceRef {
  id: string;
  kind: "confluence-space" | "jira-project";
  key: string;
  name: string;
  lastSync: string | null;
  itemCount: number;
}

/** Synced Jira issues for one project, stored as a JSON array file. */
export interface JiraRef {
  id: string;
  projectKey: string;
  title: string;
  contentFile: string;
  syncedAt: string;
  issueCount: number;
}

interface ReferenceDB {
  confluence: ConfluenceRef[];
  swagger: SwaggerRef[];
  documents: DocumentRef[];
  sources: SourceRef[];
  jira: JiraRef[];
}

import { writeJsonAtomic, readJsonSafe } from "./atomicJson";

function load(): ReferenceDB {
  const db = readJsonSafe<ReferenceDB>(DB_PATH, {
    confluence: [],
    swagger: [],
    documents: [],
    sources: [],
    jira: [],
  });
  // Back-fill arrays that may be absent in older DB files.
  db.sources ??= [];
  db.jira ??= [];
  return db;
}

function save(db: ReferenceDB) {
  writeJsonAtomic(DB_PATH, db);
}

export const referenceStore = {
  // ── Confluence ──────────────────────────────────────────────────
  addConfluence(data: Omit<ConfluenceRef, "id">): ConfluenceRef {
    const db = load();
    const existing = db.confluence.findIndex((c) => c.pageId === data.pageId);
    const ref: ConfluenceRef = { id: existing >= 0 ? (db.confluence[existing]?.id ?? uuid()) : uuid(), ...data };
    if (existing >= 0) db.confluence[existing] = ref;
    else db.confluence.push(ref);
    save(db);
    return ref;
  },

  removeConfluence(id: string) {
    const db = load();
    const ref = db.confluence.find((c) => c.id === id);
    if (ref?.contentFile && fs.existsSync(ref.contentFile)) fs.unlinkSync(ref.contentFile);
    db.confluence = db.confluence.filter((c) => c.id !== id);
    save(db);
  },

  getAllConfluence(): ConfluenceRef[] {
    return load().confluence;
  },

  // ── Swagger ─────────────────────────────────────────────────────
  addSwagger(data: Omit<SwaggerRef, "id">): SwaggerRef {
    const db = load();
    const existing = db.swagger.findIndex((s) => s.url === data.url);
    const ref: SwaggerRef = { id: existing >= 0 ? (db.swagger[existing]?.id ?? uuid()) : uuid(), ...data };
    if (existing >= 0) db.swagger[existing] = ref;
    else db.swagger.push(ref);
    save(db);
    return ref;
  },

  removeSwagger(id: string) {
    const db = load();
    const ref = db.swagger.find((s) => s.id === id);
    if (ref?.specFile && fs.existsSync(ref.specFile)) fs.unlinkSync(ref.specFile);
    db.swagger = db.swagger.filter((s) => s.id !== id);
    save(db);
  },

  getAllSwagger(): SwaggerRef[] {
    return load().swagger;
  },

  // ── Documents / Templates ───────────────────────────────────────
  addDocument(data: Omit<DocumentRef, "id">): DocumentRef {
    const db = load();
    const ref: DocumentRef = { id: uuid(), ...data };
    db.documents.push(ref);
    save(db);
    return ref;
  },

  removeDocument(id: string) {
    const db = load();
    const ref = db.documents.find((d) => d.id === id);
    if (ref?.contentFile && fs.existsSync(ref.contentFile)) fs.unlinkSync(ref.contentFile);
    db.documents = db.documents.filter((d) => d.id !== id);
    save(db);
  },

  getDocuments(type?: DocumentRef["type"]): DocumentRef[] {
    const docs = load().documents;
    return type ? docs.filter((d) => d.type === type) : docs;
  },

  getDocumentContent(id: string): string | null {
    const db = load();
    const ref = db.documents.find((d) => d.id === id);
    if (!ref || !fs.existsSync(ref.contentFile)) return null;
    return fs.readFileSync(ref.contentFile, "utf-8");
  },

  // ── Data sources (Confluence space / Jira project) ──────────────
  addSource(data: Omit<SourceRef, "id" | "lastSync" | "itemCount">): SourceRef {
    const db = load();
    const existing = db.sources.find(
      (s) => s.kind === data.kind && s.key.toLowerCase() === data.key.toLowerCase()
    );
    if (existing) return existing;
    const ref: SourceRef = { id: uuid(), lastSync: null, itemCount: 0, ...data };
    db.sources.push(ref);
    save(db);
    return ref;
  },

  updateSource(id: string, patch: Partial<Pick<SourceRef, "name" | "lastSync" | "itemCount">>) {
    const db = load();
    const ref = db.sources.find((s) => s.id === id);
    if (!ref) return;
    Object.assign(ref, patch);
    save(db);
  },

  removeSource(id: string) {
    const db = load();
    db.sources = db.sources.filter((s) => s.id !== id);
    save(db);
  },

  getSources(kind?: SourceRef["kind"]): SourceRef[] {
    const list = load().sources;
    return kind ? list.filter((s) => s.kind === kind) : list;
  },

  getSource(id: string): SourceRef | undefined {
    return load().sources.find((s) => s.id === id);
  },

  // ── Jira issue dumps ────────────────────────────────────────────
  addJira(data: Omit<JiraRef, "id">): JiraRef {
    const db = load();
    const existing = db.jira.findIndex((j) => j.projectKey === data.projectKey);
    const ref: JiraRef = {
      id: existing >= 0 ? (db.jira[existing]?.id ?? uuid()) : uuid(),
      ...data,
    };
    if (existing >= 0) db.jira[existing] = ref;
    else db.jira.push(ref);
    save(db);
    return ref;
  },

  removeJiraByProject(projectKey: string) {
    const db = load();
    const ref = db.jira.find((j) => j.projectKey === projectKey);
    if (ref?.contentFile && fs.existsSync(ref.contentFile)) fs.unlinkSync(ref.contentFile);
    db.jira = db.jira.filter((j) => j.projectKey !== projectKey);
    save(db);
  },

  getAllJira(): JiraRef[] {
    return load().jira;
  },

  getAll(): ReferenceDB {
    return load();
  },
};
