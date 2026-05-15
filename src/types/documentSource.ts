export type DocumentSourceType =
  | "brd"
  | "process_analysis"
  | "jira_task"
  | "confluence"
  | "manual";

export interface DocumentSource {
  id: string;
  type: DocumentSourceType;
  fileName: string;
  title?: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentSection {
  id: string;
  sourceId: string;
  sourceType: DocumentSourceType;
  sourceFile: string;
  title: string;
  content: string;
}