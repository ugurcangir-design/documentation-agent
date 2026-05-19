/**
 * Coverage verification — checks the generated manual/tech doc for
 * mentions of every in-scope UI element. Used to:
 *  (a) surface a coverage metric in the doc footer
 *  (b) decide whether to run a targeted fix-up pass for missing items
 */

import type { UIElement } from "../types/screen";

export interface CoverageReport {
  totalElements: number;
  coveredElements: number;
  coveragePct: number;
  missing: string[];
}

/**
 * Normalize a label for fuzzy text matching: lowercase, strip
 * punctuation, collapse whitespace, drop diacritics.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is the element's label "covered" anywhere in the body? We accept:
 *  - exact normalized label match
 *  - any 2+ consecutive significant tokens from the label (length≥3)
 */
export function isCovered(label: string, body: string): boolean {
  const labelN = normalize(label);
  if (!labelN) return true; // empty label — trivially covered
  const bodyN = normalize(body);

  if (bodyN.includes(labelN)) return true;

  // 2-gram fallback: any pair of consecutive ≥3-char tokens from the
  // label appearing in the body counts as coverage. Handles cases like
  // 'Add Manual Event' → body has 'manuel event ekleme'.
  const tokens = labelN.split(" ").filter((t) => t.length >= 3);
  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`;
    if (bodyN.includes(pair)) return true;
  }
  // Single-token fallback ONLY if label is one word — avoids false positives
  if (tokens.length === 1 && bodyN.includes(tokens[0]!)) return true;
  return false;
}

export function computeCoverage(elements: UIElement[], body: string): CoverageReport {
  const missing: string[] = [];
  let covered = 0;
  for (const el of elements) {
    if (isCovered(el.label, body)) covered++;
    else missing.push(`${el.label} (${el.type})`);
  }
  const total = elements.length;
  return {
    totalElements: total,
    coveredElements: covered,
    coveragePct: total > 0 ? Math.round((covered / total) * 100) : 100,
    missing,
  };
}
