/**
 * Context budget + diversity reranking for retrieved document sections.
 *
 * Problems before this module:
 * - Long sections (up to 31KB) consumed the entire prompt budget.
 * - The top-N could all be the same family of sections, crowding out
 *   diverse perspectives (e.g. 6 'Risk' sections, no 'Workflow').
 * - No visibility into what content was injected.
 */

import type { DocumentSection } from "../types/documentSource";
import type { RankedDocumentSection } from "./documentSearch";
import { tokenize } from "../quality/confidenceScorer";

export interface PreparedChunk {
  title: string;
  sourceFile: string;
  sourceType: string;
  content: string;
  score: number;
}

/**
 * Split a long section into smaller chunks by sub-heading (### / ##),
 * then by paragraph if still too large.
 */
function chunkSection(section: DocumentSection, targetBytes = 2500): string[] {
  const text = section.content;
  if (text.length <= targetBytes) return [text];

  // First try splitting by ## or ### sub-headings
  const subHeadingSplit = text.split(/\n(?=#{2,4}\s)/);
  if (subHeadingSplit.length > 1) {
    return subHeadingSplit.flatMap((c) =>
      c.length <= targetBytes ? [c] : chunkSection({ ...section, content: c }, targetBytes)
    );
  }

  // Fall back to paragraph splits
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let buffer = "";
  for (const p of paragraphs) {
    if ((buffer + "\n\n" + p).length > targetBytes && buffer) {
      chunks.push(buffer.trim());
      buffer = p;
    } else {
      buffer = buffer ? buffer + "\n\n" + p : p;
    }
  }
  if (buffer) chunks.push(buffer.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, targetBytes)];
}

/** Jaccard token overlap between two text strings */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * From ranked sections, prepare a diversity-aware set of chunks that
 * fits within `totalBudget` bytes. Drops chunks that are too similar
 * to ones already selected (Jaccard > 0.7 on title tokens) — but ONLY
 * within the same sourceType. A BRD section and a Confluence page with
 * the same title ("Prematch Program") are complementary, not duplicate,
 * so both are kept.
 */
export function prepareDocumentChunks(
  ranked: RankedDocumentSection[],
  totalBudget = 18_000,
  perChunkMax = 2500
): PreparedChunk[] {
  const out: PreparedChunk[] = [];
  const selected: Array<{ tokens: Set<string>; sourceType: string }> = [];
  let bytesLeft = totalBudget;

  for (const r of ranked) {
    if (bytesLeft <= 200) break;

    const titleTokens = new Set(tokenize(r.section.title));
    // Duplicate only if same sourceType AND high title overlap.
    const tooSimilar = selected.some(
      (prev) =>
        prev.sourceType === r.section.sourceType &&
        jaccard(titleTokens, prev.tokens) > 0.7
    );
    if (tooSimilar) continue;

    const chunks = chunkSection(r.section, perChunkMax);
    // Keep just the first chunk of each long section (the introductory part
    // is usually most relevant for documentation); subsequent chunks tend to
    // be implementation detail.
    const firstChunk = chunks[0] ?? "";
    const trimmed = firstChunk.slice(0, Math.min(firstChunk.length, bytesLeft));
    if (trimmed.length < 100) continue;

    out.push({
      title: r.section.title,
      sourceFile: r.section.sourceFile ?? "",
      sourceType: r.section.sourceType,
      content: trimmed,
      score: r.score,
    });
    selected.push({ tokens: titleTokens, sourceType: r.section.sourceType });
    bytesLeft -= trimmed.length;
  }

  return out;
}
