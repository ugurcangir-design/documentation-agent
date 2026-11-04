/**
 * Davranış kapsamı (Faz 5) — SAF, deterministik, 0 token.
 *
 * UI-öğesi kapsamına ek ikinci eksen: her BehaviorFact kılavuz gövdesinde
 * gerçekten anlatılmış mı? Ölçüt (ikisinden biri):
 *  (a) kuralın tırnaklı alan etiketlerinin çoğu gövdede geçiyor VE türe ait
 *      bir sinyal ifadesi var (öncelik: "dahil edilmez/dikkate alınmaz/…");
 *  (b) kural cümlesinin anlamlı token'larının ≥%60'ı gövdede geçiyor.
 * Metin tabanlıdır; görsel-judge kullanılmaz (kararlı, ucuz).
 */

import type { BehaviorFact } from "../types/behavior";
import { isCovered } from "./coverageCheck";
import { tokenize } from "./confidenceScorer";

export interface BehaviorCoverageReport {
  total: number;
  covered: number;
  pct: number;
  missing: BehaviorFact[];
}

const KIND_SIGNAL: Record<BehaviorFact["kind"], RegExp> = {
  "filter-precedence": /(dahil edilmez|dikkate al[ıi]n?maz|yok say[ıi]l|göz ard[ıi]|geçersiz|yaln[ıi]z|sadece|öncelik)/i,
  "filter-combine": /(birlikte|beraber|daralt|ikisi de|hepsi|tüm filtreler)/i,
  "required-field": /(zorunlu|en az bir|girilmeden|gerekir|boş .{0,40}(arama|liste|kay[ıi]t)|tüm kay[ıi]tlar)/i,
  pagination: /(sayfa|sayfalama|kay[ıi]t say[ıi]s[ıi])/i,
  sort: /(s[ıi]rala|s[ıi]ralama)/i,
  validation: /(uyar[ıi]|hata|doğrulama|geçersiz)/i,
  navigation: /(yönlen|açıl|gider|sayfas[ıi]na)/i,
  other: /(temizle|s[ıi]f[ıi]rla|kural|davran[ıi]ş)/i,
};

function quotedLabels(statement: string): string[] {
  return [...statement.matchAll(/"([^"]{2,40})"/g)].map((m) => m[1]!);
}

export function isBehaviorCovered(f: BehaviorFact, body: string): boolean {
  const labels = quotedLabels(f.statement);
  if (labels.length > 0) {
    const hit = labels.filter((l) => isCovered(l, body)).length;
    const enough = hit >= Math.max(1, Math.ceil(labels.length * 0.6));
    if (enough && KIND_SIGNAL[f.kind].test(body)) return true;
  } else if (KIND_SIGNAL[f.kind].test(body)) {
    // Etiketsiz kural (sayfalama/sıralama/boş arama): cümle teknik, gövde
    // kullanıcı dilinde → türe ait sinyal kapsam için yeterli.
    return true;
  }
  const toks = tokenize(f.statement);
  if (toks.length === 0) return false;
  const bodyL = body.toLowerCase();
  const found = toks.filter((t) => bodyL.includes(t.slice(0, Math.max(4, t.length - 2)))).length;
  return found / toks.length >= 0.6;
}

export function computeBehaviorCoverage(behaviors: BehaviorFact[], body: string): BehaviorCoverageReport {
  const missing: BehaviorFact[] = [];
  let covered = 0;
  for (const f of behaviors) {
    if (isBehaviorCovered(f, body)) covered++;
    else missing.push(f);
  }
  const total = behaviors.length;
  return { total, covered, pct: total > 0 ? Math.round((covered / total) * 100) : 100, missing };
}
