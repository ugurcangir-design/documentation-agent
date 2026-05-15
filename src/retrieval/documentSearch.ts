import { DocumentSection } from "../types/documentSource";

import { calculateConfidenceScore } from "../quality/confidenceScorer";

import { applySourcePriority } from "../quality/sourcePriority";

export interface RankedDocumentSection {
  score: number;
  section: DocumentSection;
}

export function searchDocumentSections(
  sections: DocumentSection[],
  keyword: string
): RankedDocumentSection[] {
  const ranked: RankedDocumentSection[] = [];

  for (const section of sections) {
    const baseScore = calculateConfidenceScore(
      section.title,
      section.content,
      keyword
    );

    const finalScore = applySourcePriority(
      baseScore,
      section.sourceType
    );

    if (finalScore > 0) {
      ranked.push({
        score: finalScore,
        section,
      });
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}