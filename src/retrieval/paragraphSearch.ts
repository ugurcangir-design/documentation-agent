/**
 * Paragraph-level retrieval — complements section-level search by
 * grabbing individual paragraphs that mention query terms, even when
 * they live inside otherwise low-ranked sections.
 *
 * Use case: the BRD is huge. Some Prematch-relevant detail might be
 * buried in a paragraph inside a section titled "General Settings"
 * (which won't rank high). We don't want to miss it.
 */

import type { DocumentSection } from "../types/documentSource";
import { tokenize } from "../quality/confidenceScorer";

export interface MatchedParagraph {
  sectionTitle: string;
  sourceFile: string;
  paragraph: string;
  hits: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Walk every section's content paragraph-by-paragraph, count how many
 * query tokens hit, and return paragraphs above a minimum hit count.
 *
 * Tokens of length < 4 are dropped here (too noisy at paragraph level).
 * Limits per-section results to prevent one huge section flooding output.
 */
export function searchParagraphs(
  sections: DocumentSection[],
  query: string,
  options: { minHits?: number; maxPerSection?: number; maxTotal?: number } = {}
): MatchedParagraph[] {
  const { minHits = 2, maxPerSection = 3, maxTotal = 25 } = options;

  const tokens = tokenize(query).filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];

  // Suffix-toleranslı, Unicode-aware OR-regex: Türkçe çekim ekleri
  // (-ler, -leri, -nin, -dan, -ı/-ü/-ünden vb.) absorbe edilir; ı/ş/ğ/ç/ö/ü
  // harflerini de tanır (default \w ASCII-only olduğu için \p{L}\p{N}+u
  // gerekir). confidenceScorer.buildTokenRegex ile aynı patern.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${tokens.map(escapeRegExp).join("|")})[\\p{L}\\p{N}]{0,8}(?![\\p{L}\\p{N}])`,
    "giu"
  );

  const results: MatchedParagraph[] = [];

  for (const section of sections) {
    if (!section.content) continue;
    const paragraphs = section.content.split(/\n{2,}/);
    let kept = 0;
    for (const p of paragraphs) {
      if (kept >= maxPerSection) break;
      // Min 30 char: süreç analizi soruları ("Bu işlem ne zaman tetiklenir?")
      // tipik 30-80 char; eski 60 char eşiği bunları eliyordu. Max 2500:
      // boilerplate page-footer paragraflarının indeksi şişirmesi önlenir.
      if (p.length < 30 || p.length > 2500) continue;
      const matches = p.match(pattern);
      const hits = matches ? matches.length : 0;
      if (hits < minHits) continue;
      results.push({
        sectionTitle: section.title,
        sourceFile: section.sourceFile ?? "",
        paragraph: p.trim(),
        hits,
      });
      kept++;
    }
  }

  return results
    .sort((a, b) => b.hits - a.hits)
    .slice(0, maxTotal);
}
