import { DocumentSourceType } from "../types/documentSource";

export function getSourcePriority(
  sourceType: DocumentSourceType
): number {
  switch (sourceType) {
    case "brd":
      return 1.0;

    case "process_analysis":
      return 0.95;

    case "confluence":
      return 0.85;

    case "jira_task":
      return 0.75;

    case "manual":
      return 0.6;

    default:
      return 0.5;
  }
}

export function applySourcePriority(
  baseScore: number,
  sourceType: DocumentSourceType
): number {
  return Math.round(
    baseScore * getSourcePriority(sourceType)
  );
}