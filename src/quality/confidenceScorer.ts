function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Stopword listesi — yalnızca **dilbilgisel** dolgu kelimeleri.
 * Önceki sürümde "kullanıcı, ekran, sayfa, tıkla, açılır" gibi domain
 * sözcükleri de buradaydı; ama bunlar gerçek sorgu token'ı olabilir
 * (örn. "kullanıcı yönetimi", "ekran kilidi"). Stopword'e alınınca
 * BRD/Confluence başlıklarındaki eşleşmeler kaçıyordu. Geri çıkarıldı.
 */
const STOPWORDS = new Set([
  "ve", "ile", "için", "bir", "bu", "şu", "o", "the", "a", "an",
  "is", "are", "of", "to", "in", "on", "at", "as", "by", "or",
  "var", "yok", "vardır", "olur", "ise", "de", "da",
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

/**
 * Türkçe için suffix-toleranslı regex: `etkinlik` token'ı `etkinlikler`,
 * `etkinliği`, `etkinliklerin` gibi formları yakalar. 8 karaktere kadar
 * ek (suffix) chain'ini absorbe eder; bu Türkçe'nin tipik ek kombinasyon
 * uzunluğunu (–lerimden, –larındaki, …) kapsar.
 *
 * **Unicode-aware:** `\w` default'u yalnız ASCII tanır; Türkçe ı/ş/ğ/ç/ö/ü
 * harflerini kaçırırdı ("filtreyı", "süzgeçleri" eski regex'te eşleşmiyordu).
 * `\p{L}\p{N}` + `u` flag ile çözüldü. Word boundary için `\b` yerine
 * lookahead/lookbehind kullanılıyor, çünkü `\b` da ASCII-only.
 *
 * Suffix'siz form da uzunluk 0 ile match'lenir → eski exact behavior'a
 * geriye dönük uyumlu.
 */
export function buildTokenRegex(token: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(token)}[\\p{L}\\p{N}]{0,8}(?![\\p{L}\\p{N}])`,
    "giu"
  );
}

function countAny(text: string, tokens: string[]): number {
  let n = 0;
  for (const t of tokens) {
    if (!t) continue;
    n += (text.match(buildTokenRegex(t)) || []).length;
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
