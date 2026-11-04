/**
 * Referans kural çıkarımı (Faz 3) — SAF, 0 token.
 *
 * BRD / Confluence / Jira / süreç analizi bölümlerinden "kural cümlesi"
 * adaylarını deterministik kalıplarla çıkarır (-malı/-meli, dikkate alınmaz,
 * yok sayılır, zorunlu, yalnızca, öncelik, kabul kriteri; EN: must/should/
 * required/ignored/only). LLM kullanılmaz; yorum/normalizasyon istenirse
 * ayrı opt-in adımdır. Çıktı, gözlemlenen davranışlarla çapraz doğrulama
 * (behaviorCrossCheck) için girdi.
 */

import type { DocumentSection } from "../types/documentSource";

export interface ReferenceRule {
  text: string;
  sourceType: string;
  sourceId: string;
  sourceFile: string;
  /** Bölüm başlığı (Jira'da "KEY — özet"). */
  title: string;
  /** Jira anahtarı gibi kısa kimlik (varsa). */
  refId?: string;
}

const RULE_PATTERNS: RegExp[] = [
  /\b\w+(malı|meli|malıdır|melidir|malıdırlar|melidirler)\b/i,
  /dikkate al(ın)?ma(z|yacak|malı)/i,
  /yok say(ıl|ma)/i, /göz ardı/i, /geçersiz (kıl|say)/i,
  /\bzorunlu/i, /\bgerekli(dir)?\b/i, /\bgerekmektedir\b/i,
  /\byaln[ıi]z(ca)?\b/i, /\bsadece\b/i, /\böncelik/i,
  /\bkabul kriter/i, /\bbeklenen sonuç/i,
  /\b(must|should|shall|required|mandatory|only|ignored|ignore|precedence|takes priority)\b/i,
];
const MAX_PER_SECTION = 12;
const MAX_TOTAL = 120;
const MAX_LEN = 320;
const MIN_LEN = 25;

/** Metni cümle/madde parçalarına böler. */
function splitUnits(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"“(])/)
    .map((u) => u.replace(/^[\s\-\*•·\d.)]+/, "").replace(/\s+/g, " ").trim())
    .filter((u) => u.length >= MIN_LEN);
}

export function isRuleLike(sentence: string): boolean {
  return RULE_PATTERNS.some((p) => p.test(sentence));
}

function refIdOf(title: string): string | undefined {
  const m = /^([A-Z][A-Z0-9]+-\d+)/.exec(title.trim());
  return m ? m[1] : undefined;
}

export function extractReferenceRules(sections: DocumentSection[]): ReferenceRule[] {
  const out: ReferenceRule[] = [];
  const seen = new Set<string>();
  for (const s of sections) {
    let n = 0;
    for (const u of splitUnits(s.content || "")) {
      if (n >= MAX_PER_SECTION || out.length >= MAX_TOTAL) break;
      if (!isRuleLike(u)) continue;
      const text = u.length > MAX_LEN ? u.slice(0, MAX_LEN - 1) + "…" : u;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const refId = refIdOf(s.title);
      out.push({ text, sourceType: s.sourceType, sourceId: s.sourceId, sourceFile: s.sourceFile, title: s.title, ...(refId ? { refId } : {}) });
      n++;
    }
    if (out.length >= MAX_TOTAL) break;
  }
  return out;
}
