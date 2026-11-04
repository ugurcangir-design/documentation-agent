/**
 * Davranış × referans çapraz doğrulama (Faz 3) — SAF, 0 token.
 *
 * Gözlemlenen BehaviorFact'leri referans kural cümleleriyle (ruleExtractor)
 * eşler: eşleşen referanslar `refs`'e eklenir, `source` 'both' olur; kural
 * yönü ters görünüyorsa `conflict` işaretlenir (muhafazakâr). Ekranla ilgili
 * olup gözlemle eşleşmeyen referans kuralları 'reference' kaynaklı, medium
 * güvenilirlikli ek kural olarak döner (kılavuzda "BRD/Jira'ya göre" diye
 * koşullu anlatılır — uydurma değil, kaynaklı).
 */

import { tokenize } from "./confidenceScorer";
import type { BehaviorFact, BehaviorRef } from "../types/behavior";
import type { ReferenceRule } from "../retrieval/ruleExtractor";

/** Türkçe/İngilizce filtre-arama sözlüğü — token eşleşmesini genişletir. */
const SYNONYMS: string[][] = [
  ["filtre", "filter", "süzgeç", "filtreler", "filters", "kriter"],
  ["arama", "ara", "search", "sorgu", "query", "listele", "list"],
  ["id", "kimlik", "numara", "no", "identifier"],
  ["dikkate", "alınmaz", "yok", "sayılır", "ignore", "ignored", "geçersiz", "ardı"],
  ["öncelik", "precedence", "priority", "üstün", "baskın"],
  ["zorunlu", "required", "mandatory", "gerekli", "gerekmektedir"],
  ["boş", "empty", "blank", "girilmeden", "hiçbir"],
  ["temizle", "clear", "reset", "sıfırla", "sıfırlar"],
  ["sayfa", "page", "sayfalama", "pagination", "size", "boyut"],
  ["sırala", "sort", "sıralama", "order"],
  ["birlikte", "combine", "and", "beraber", "tümü", "hepsi"],
];
const CANON = new Map<string, string>();
for (const group of SYNONYMS) for (const w of group) CANON.set(w, group[0]!);

function canonTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) out.add(CANON.get(t) ?? t);
  // tokenize 3+ karakter ister; "id"/"no" gibi kısa anahtarları ayrıca yakala
  for (const m of text.toLowerCase().matchAll(/\b(id|no)\b/g)) out.add(CANON.get(m[1]!) ?? m[1]!);
  return out;
}

function overlap(a: Set<string>, b: Set<string>): { shared: number; jaccard: number } {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return { shared, jaccard: union === 0 ? 0 : shared / union };
}

function factVocabulary(f: BehaviorFact): string {
  const keys = (f.evidence.requests ?? []).flatMap((r) => [...Object.keys(r.query), ...(r.bodyKeys ?? [])]).join(" ");
  // camelCase anahtarları kelimelere aç (ticketId → ticket id)
  const split = keys.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${f.statement} ${f.kind.replace("-", " ")} ${split}`;
}

const PRECEDENCE_NEG = /(dikkate al(ın)?maz|dikkate al(ın)?mayacak|yok say|göz ardı|ignore|geçersiz|yaln[ıi]z|sadece|\bonly\b|öncelik|precedence)/i;
const COMBINE_POS = /(birlikte|beraber|tüm filtreler|hepsi uygulan|combine|together|all filters|and ile)/i;
const REQUIRED_POS = /(zorunlu|required|mandatory|gerekli|gerekmektedir|en az bir|girilmeden|boş bırakılamaz|cannot be empty)/i;
const REQUIRED_OPP = /(zorunlu değil|isteğe bağlı|optional|not required|boş bırakılabilir)/i;
const PAGINATION_SIG = /(sayfa|page|pagination|boyut|\bsize\b|limit)/i;
const SORT_SIG = /(sırala|sort|order)/i;

/** Tür-farkında eşleşme: kuralda o türe ait sinyal (veya zıt sinyal) olmalı —
 *  salt konu örtüşmesi (ticket/arama/filtre) alakasız kuralı iliştirmesin. */
function kindSignal(kind: BehaviorFact["kind"], text: string): { pos: boolean; opp: boolean } {
  switch (kind) {
    case "filter-precedence": return { pos: PRECEDENCE_NEG.test(text), opp: COMBINE_POS.test(text) && !PRECEDENCE_NEG.test(text) };
    case "filter-combine":    return { pos: COMBINE_POS.test(text), opp: PRECEDENCE_NEG.test(text) && !COMBINE_POS.test(text) };
    case "required-field":    return { pos: REQUIRED_POS.test(text), opp: REQUIRED_OPP.test(text) };
    case "pagination":        return { pos: PAGINATION_SIG.test(text), opp: false };
    case "sort":              return { pos: SORT_SIG.test(text), opp: false };
    default:                  return { pos: true, opp: false };
  }
}

export interface CrossCheckOptions {
  /** Jaccard eşiği (vars. 0.18) VEYA en az bu kadar ortak token (vars. 3). */
  minJaccard?: number;
  minShared?: number;
  /** Yalnız-referans kuralı eklemek için ekran kelime dağarcığıyla asgari örtüşme. */
  refOnlyMinShared?: number;
  maxRefOnly?: number;
}

export function crossCheckBehaviors(
  facts: BehaviorFact[],
  rules: ReferenceRule[],
  screenVocab: string,
  opts: CrossCheckOptions = {}
): BehaviorFact[] {
  const { minJaccard = 0.12, minShared = 2, refOnlyMinShared = 3, maxRefOnly = 5 } = opts;
  const ruleTok = rules.map((r) => ({ r, tok: canonTokens(r.text) }));
  const matchedRuleIdx = new Set<number>();

  const verified: BehaviorFact[] = facts.map((f) => {
    const ft = canonTokens(factVocabulary(f));
    const factRequires = f.kind === "required-field" && /gerekir|zorunlu/.test(f.statement);
    const hits: Array<{ i: number; score: number; opp: boolean }> = [];
    ruleTok.forEach(({ r, tok }, i) => {
      const o = overlap(ft, tok);
      const topical = o.jaccard >= minJaccard || o.shared >= minShared;
      if (!topical) return;
      const sig = kindSignal(f.kind, r.text);
      if (!sig.pos && !sig.opp) return;
      hits.push({ i, score: o.jaccard + o.shared / 10 + (sig.pos ? 0.2 : 0), opp: sig.opp });
    });
    if (hits.length === 0) return f;
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, 2);
    const refs: BehaviorRef[] = top.map(({ i }) => {
      const r = ruleTok[i]!.r;
      matchedRuleIdx.add(i);
      return { type: r.sourceType, id: r.refId ?? r.sourceId, title: r.title };
    });
    // Çelişki (muhafazakâr): zıt sinyal taşıyan eşleşme. required-field'da
    // polarite: gözlem "gerekir" derken referans "isteğe bağlı" (veya tersi).
    let conflict = false;
    for (const h of top) {
      const txt = ruleTok[h.i]!.r.text;
      if (f.kind === "required-field") {
        const sig = kindSignal(f.kind, txt);
        if ((factRequires && sig.opp) || (!factRequires && sig.pos && !sig.opp)) conflict = true;
      } else if (h.opp) conflict = true;
    }
    return { ...f, source: "both", refs, ...(conflict ? { conflict: true } : {}) };
  });

  // Yalnız-referans kuralları: ekranla ilgili ama gözlemle eşleşmeyen.
  const vocab = canonTokens(`${screenVocab} ${facts.map(factVocabulary).join(" ")}`);
  const refOnly: BehaviorFact[] = [];
  ruleTok.forEach(({ r, tok }, i) => {
    if (matchedRuleIdx.has(i) || refOnly.length >= maxRefOnly) return;
    const o = overlap(vocab, tok);
    if (o.shared < refOnlyMinShared) return;
    const kind: BehaviorFact["kind"] = /zorunlu|required|mandatory|gerekmektedir/i.test(r.text) ? "required-field"
      : PRECEDENCE_NEG.test(r.text) && /filtre|filter|arama|search/i.test(r.text) ? "filter-precedence"
      : /sayfa|page|pagination/i.test(r.text) ? "pagination"
      : /sırala|sort/i.test(r.text) ? "sort" : "other";
    refOnly.push({
      id: `bf_ref_${i}`,
      screenPath: facts[0]?.screenPath ?? "",
      kind,
      statement: r.text,
      evidence: { note: "yalnız referans — canlı gözlemle doğrulanmadı" },
      source: "reference",
      refs: [{ type: r.sourceType, id: r.refId ?? r.sourceId, title: r.title }],
      confidence: "medium",
    });
  });

  return [...verified, ...refOnly];
}
