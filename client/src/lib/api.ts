import type {
  StoredScreen,
  StoredDocument,
  Job,
  ConfluencePage,
  PublishMode,
  DocumentStatus,
} from "../types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// ── Discovery ────────────────────────────────────────────────────
export const discovery = {
  start: (extraUrls: string[] = []) =>
    request<{ jobId: string }>("/discovery/start", {
      method: "POST",
      body: JSON.stringify({ extraUrls }),
    }),

  getScreens: () => request<StoredScreen[]>("/discovery/screens"),

  stream: (jobId: string) =>
    new EventSource(`${BASE}/discovery/${jobId}/stream`),
};

// ── Jobs ─────────────────────────────────────────────────────────
export const jobs = {
  start: (screenPaths: string[]) =>
    request<{ jobId: string }>("/jobs/start", {
      method: "POST",
      body: JSON.stringify({ screenPaths }),
    }),

  getAll: () => request<Job[]>("/jobs"),

  getById: (jobId: string) => request<Job>(`/jobs/${jobId}`),

  stream: (jobId: string) =>
    new EventSource(`${BASE}/jobs/${jobId}/stream`),
};

// ── Documents ────────────────────────────────────────────────────
export const documents = {
  getAll: () => request<StoredDocument[]>("/documents"),

  getGrouped: () =>
    request<Record<string, StoredDocument[]>>("/documents/grouped"),

  getById: (id: string) => request<StoredDocument>(`/documents/${id}`),

  update: (
    id: string,
    data: { userManualContent?: string; technicalDocContent?: string }
  ) =>
    request<StoredDocument>(`/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  setStatus: (id: string, status: DocumentStatus) =>
    request<StoredDocument>(`/documents/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  delete: (id: string) =>
    request<{ ok: boolean }>(`/documents/${id}`, { method: "DELETE" }),
};

// ── Confluence ───────────────────────────────────────────────────
export const confluence = {
  searchPages: (q: string) =>
    request<ConfluencePage[]>(`/confluence/pages/search?q=${encodeURIComponent(q)}`),

  publish: (params: {
    documentIds: string[];
    mode: PublishMode;
    parentPageId?: string;
    title?: string;
  }) =>
    request<{ ok: boolean; count: number }>("/confluence/publish", {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

// ── Export ───────────────────────────────────────────────────────
export const exportApi = {
  downloadDocx: async (documentIds: string[], title?: string) => {
    const res = await fetch(`${BASE}/export/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds, title }),
    });

    if (!res.ok) throw new Error("Export failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title ?? "dokuman"}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
