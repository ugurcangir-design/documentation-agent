import type {
  StoredScreen,
  StoredDocument,
  Job,
  ConfluencePage,
  PublishMode,
  DocumentStatus,
} from "../types";

const BASE = "/api";

/**
 * Yerel DocAgent server'ının CSRF guard'ı (X-DocAgent: 1) için ortak
 * header. Cross-origin saldırılarda tarayıcı bu custom header için
 * preflight ister; sunucu izin vermediği için istek bloklanır.
 */
export const DOCAGENT_HEADER = { "X-DocAgent": "1" } as const;

export class CsrfBlockedError extends Error {
  constructor() {
    super(
      "İstek sunucu tarafından engellendi (CSRF guard). " +
      "DocAgent'a yalnızca kendi sekmesinden çağrı yapılabilir. " +
      "Sayfayı yenileyip tekrar deneyin; sorun sürerse sunucu yeniden başlatılması gerekebilir."
    );
    this.name = "CsrfBlockedError";
  }
}

/** Tüm sayfaların dinleyip global bir banner/toast gösterebilmesi için. */
function emitCsrfBlocked(): void {
  window.dispatchEvent(new CustomEvent("docagent:csrf-blocked"));
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...DOCAGENT_HEADER,
      ...(options?.headers ?? {}),
    },
  });

  if (!res.ok) {
    if (res.status === 403) {
      emitCsrfBlocked();
      throw new CsrfBlockedError();
    }
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

  /** Sadece üretilmemiş ekranlar için yeni bir job başlat. Önceki job'un
   *  screenPaths set'i ile mevcut documents.screenPath'in farkı kullanılır.
   *  Token tasarrufu: zaten üretilen dokümanlar yeniden ödenmez. */
  retryMissing: (jobId: string) =>
    request<{ jobId: string; count: number }>(`/jobs/${jobId}/retry-missing`, {
      method: "POST",
    }),

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
async function downloadAs(endpoint: string, body: unknown, filename: string): Promise<void> {
  const res = await fetch(`${BASE}/export/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...DOCAGENT_HEADER },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    emitCsrfBlocked();
    throw new CsrfBlockedError();
  }
  if (!res.ok) throw new Error(`Export failed: ${endpoint}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const exportApi = {
  downloadDocx: (documentIds: string[], title?: string) =>
    downloadAs("docx", { documentIds, title }, `${title ?? "dokuman"}.docx`),
  downloadPdf: (documentIds: string[], title?: string) =>
    downloadAs("pdf", { documentIds, title }, `${title ?? "dokuman"}.pdf`),
  downloadMarkdown: (documentIds: string[], title?: string) =>
    downloadAs("markdown", { documentIds, title }, `${title ?? "dokuman"}.md`),
  downloadZip: (documentIds: string[], title?: string) =>
    downloadAs("zip", { documentIds, title }, `${title ?? "dokuman"}.zip`),
};

// ── Job control ──────────────────────────────────────────────────
export const jobControl = {
  cancel: (jobId: string) =>
    fetch(`${BASE}/jobs/${jobId}/cancel`, { method: "POST", headers: DOCAGENT_HEADER }).then((r) => r.json()) as Promise<{ ok: boolean }>,
  pause: (jobId: string) =>
    fetch(`${BASE}/jobs/${jobId}/pause`, { method: "POST", headers: DOCAGENT_HEADER }).then((r) => r.json()) as Promise<{ ok: boolean }>,
  resume: (jobId: string) =>
    fetch(`${BASE}/jobs/${jobId}/resume`, { method: "POST", headers: DOCAGENT_HEADER }).then((r) => r.json()) as Promise<{ ok: boolean }>,
};

// ── Section regeneration ─────────────────────────────────────────
export const sections = {
  list: (documentId: string, target: "userManual" | "technicalDoc") =>
    request<Array<{ heading: string; level: number }>>(
      `/documents/${documentId}/sections?target=${target}`
    ),
  regenerate: (
    documentId: string,
    body: { sectionHeading: string; instruction: string; target: "userManual" | "technicalDoc" }
  ) =>
    request<StoredDocument>(`/documents/${documentId}/regenerate-section`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
