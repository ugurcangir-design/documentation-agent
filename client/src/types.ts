export interface StoredScreenState {
  label: string;
  triggeredBy: string;
  screenshotPath: string;
}

export interface StoredScreen {
  url: string;
  path: string;
  title: string;
  screenshotPath: string;
  depth: number;
  parentPath?: string;
  discoveredAt: string;
  states?: StoredScreenState[];
}

export type DocumentStatus = "draft" | "approved" | "published";

export interface DocumentVersion {
  id: string;
  savedAt: string;
  reason: "edit" | "regenerate" | "publish";
  userManualContent: string;
  technicalDocContent: string;
}

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
  versions?: DocumentVersion[];
  inputTokens?: number;
  outputTokens?: number;
}

export type JobStatus = "pending" | "running" | "completed" | "failed";
export type JobType = "discovery" | "documentation";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: {
    current: number;
    total: number;
    message: string;
  };
  error?: string;
}

export interface JobEvent {
  type: "progress" | "screen" | "complete" | "error";
  message: string;
  current?: number;
  total?: number;
  data?: unknown;
}

export interface ConfluencePage {
  id: string;
  title: string;
  url: string;
}

export type PublishMode = "new" | "append" | "child";
