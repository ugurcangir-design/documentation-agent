/**
 * Coverage verification — checks the generated manual/tech doc for
 * mentions of every in-scope UI element. Used to:
 *  (a) surface a coverage metric in the doc footer
 *  (b) decide whether to run a targeted fix-up pass for missing items
 */

import type { UIElement } from "../types/screen";
import { buildTokenRegex } from "./confidenceScorer";

export interface CoverageReport {
  totalElements: number;
  coveredElements: number;
  coveragePct: number;
  missing: string[];
  /** LLM-judge (verifiedCoverage) çalıştı VE başarılı oldu mu?
   *  - undefined: judge hiç çağrılmadı (COVERAGE_LLM_JUDGE=false → beklenen)
   *  - true: judge doğruladı
   *  - false: judge çağrılması gerekiyordu ama BAŞARISIZ oldu (ham coverage'a
   *    düşüldü) → kapsam güvenilir değil, kullanıcıya bildirilmeli. */
  verified?: boolean;
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bir kelime dizisinin (phrase) gövdede KELİME SINIRLARIYLA, ardışık ve
 * Türkçe ek-toleransıyla geçip geçmediğini denetler. Örn. ["yeni","kayıt"]
 * → "yeni kayıt formu" ✓, "yenileme kaydı" ✗ (sınır), "karakter" içindeki
 * "ara" ✗ (lookbehind). Substring `includes`'in yanlış-pozitiflerini
 * (ör. "Ara" → "kArAkter", "Ekle" → "bEKLEnen") eler.
 */
function phraseMatches(bodyN: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  // Her token'a suffix toleransı (Türkçe çekim), aralarında whitespace,
  // baş/son kelime sınırı. buildTokenRegex ile aynı Unicode-aware kalıp.
  const inner = tokens
    .map((t) => `${escapeRegExp(t)}[\\p{L}\\p{N}]{0,8}`)
    .join("\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${inner}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(bodyN);
}

/**
 * Is the element's label "covered" anywhere in the body? Kelime-sınırlı,
 * Türkçe ek-toleranslı eşleşme (substring DEĞİL — substring "Ara" etiketini
 * "karakter" içinde bulup sahte coverage üretiyordu). Kabul kriterleri:
 *  - Etiketin tüm anlamlı token'ları ardışık, kelime-sınırlı geçiyorsa
 *  - VEYA etiketten herhangi 2 ardışık token kelime-sınırlı geçiyorsa
 *  - Tek kelimeli etikette o token kelime-sınırlı (ek-toleranslı) geçiyorsa
 */
export function isCovered(label: string, body: string): boolean {
  const labelN = normalize(label);
  if (!labelN) return true; // empty label — trivially covered
  const bodyN = normalize(body);

  const tokens = labelN.split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0) {
    // Etiket yalnızca çok kısa token'lardan oluşuyor (ör. "OK", "No") —
    // tüm etiketi kelime-sınırıyla ara (ek-tolerans yok, kısa token gürültüsü).
    const shortToks = labelN.split(" ").filter(Boolean);
    return shortToks.length > 0 && phraseMatches(bodyN, shortToks);
  }

  // Tüm anlamlı token'lar ardışık (tam etiket)
  if (phraseMatches(bodyN, tokens)) return true;

  // 2-gram fallback: herhangi ardışık ikili (ör. 'Add Manual Event' →
  // 'manuel event ekleme' içinde 'manuel event').
  for (let i = 0; i < tokens.length - 1; i++) {
    if (phraseMatches(bodyN, [tokens[i]!, tokens[i + 1]!])) return true;
  }

  // Tek kelimeli etiket → kelime-sınırlı (ek-toleranslı) tekli eşleşme
  if (tokens.length === 1 && buildTokenRegex(tokens[0]!).test(bodyN)) return true;
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
