function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOPWORDS = new Set([
  "ve", "ile", "için", "bir", "bu", "şu", "o", "the", "a", "an",
  "is", "are", "of", "to", "in", "on", "at", "as", "by", "or",
  "var", "yok", "vardır", "olur", "kullanıcı", "ekran", "sayfa",
  "tıkla", "tıklayın", "tıklandığında", "tıklanır", "açılır",
]);

/** Extract distinct keyword tokens from a free-text query, normalized
 *  to lowercase, stopwords removed, very short tokens dropped. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ") // keep letters/numbers
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function countAny(text: string, tokens: string[]): number {
  let n = 0;
  for (const t of tokens) {
    if (!t) continue;
    const re = new RegExp(`\\b${escapeRegExp(t)}\\b`, "gi");
    n += (text.match(re) || []).length;
  }
  return n;
}

export function calculateConfidenceScore(
  title: string,
  content: string,
  query: string
): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  const normalizedTitle = title.toLowerCase();
  const normalizedContent = content.toLowerCase();

  let score = 0;

  // ── Title matching: each distinct token in title scores ──────
  let titleHits = 0;
  for (const t of tokens) {
    if (normalizedTitle.includes(t)) titleHits++;
  }
  // Strong boost when most tokens land in title
  score += titleHits * 12;

  // Heavy boost when title hits a multi-word phrase (rare = precise)
  if (titleHits >= 2) score += 30;

  // ── Content density: occurrences across all tokens ───────────
  const contentHits = countAny(normalizedContent, tokens);
  score += Math.min(contentHits, 30); // cap so a single huge section doesn't dominate

  // ── Length sanity ────────────────────────────────────────────
  if (normalizedContent.length < 200) score -= 5;
  if (normalizedContent.length > 50_000) score += 2; // big section probably feature-complete

  // ── Important-keyword boosts, only when those words are in
  //    the query (not a global bias toward risk/limit/etc.) ──
  const importantTerms = [
    "business rule", "iş kuralı", "endpoint", "validation",
    "workflow", "status", "limit", "risk",
  ];
  for (const kw of importantTerms) {
    if (query.toLowerCase().includes(kw) && normalizedTitle.includes(kw)) {
      score += 4;
    }
  }

  return Math.max(score, 0);
}
