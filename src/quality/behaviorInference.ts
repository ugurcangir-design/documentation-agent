/**
 * Davranış çıkarımı (Faz 2) — SAF fonksiyonlar, 0 token.
 *
 * Kontrollü arama deneylerinin (probe) ürettiği istek kayıtlarından ekranın
 * davranış kurallarını türetir. Örnek: yalnız "Ticket ID" doluyken istekte
 * `ticketId` var; "Ticket ID"+"Retailer ID" doluyken istekte yine YALNIZ
 * `ticketId` var → "Ticket ID doluyken Retailer ID filtresi isteğe dahil
 * edilmez" (filter-precedence, high).
 *
 * Alan→parametre eşlemesi önceden bilinmez; tek-alan deneylerinde boş-arama
 * taban çizgisine (page/size gibi) eklenen anahtarlar o alana atfedilir.
 */

import type { BehaviorFact, NetRequest } from "../types/behavior";

export interface ProbeRun {
  /** "empty" | "single:<alan>" | "combo:<A>+<B>" | "reset" | serbest */
  id: string;
  /** Deneyde doldurulan alanlar (etiket → değer, maskeli). */
  filled: Record<string, string>;
  /** Deneyin tetiklediği arama isteği (yoksa istek gitmedi). */
  request?: NetRequest;
  /** Ekranda görülen uyarı/doğrulama mesajı (varsa). */
  message?: string;
  /** Bu deneyin görsel state etiketi (varsa). */
  stateLabel?: string;
}

function keysOf(r?: NetRequest): string[] {
  if (!r) return [];
  return [...Object.keys(r.query), ...(r.bodyKeys ?? [])];
}

function minus(a: string[], b: Set<string>): string[] {
  return a.filter((k) => !b.has(k));
}

function same(a: string[], b: string[]): boolean {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

let seq = 0;
function fact(screenPath: string, kind: BehaviorFact["kind"], statement: string,
  evidence: BehaviorFact["evidence"], confidence: BehaviorFact["confidence"]): BehaviorFact {
  return { id: `bf_${Date.now().toString(36)}_${++seq}`, screenPath, kind, statement, evidence, source: "observed", confidence };
}

const PAGINATION_KEYS = /^(page|pageNumber|pageIndex|offset|size|pageSize|limit|perPage|rows)$/i;
const SORT_KEYS = /^(sort|sortBy|sortField|order|orderBy|sortDirection|direction|dir)$/i;

/**
 * Deney kayıtlarından davranış kuralları türetir. Girdi sırası önemsiz.
 */
export function inferBehaviors(screenPath: string, runs: ProbeRun[]): BehaviorFact[] {
  const out: BehaviorFact[] = [];
  const empty = runs.find((r) => r.id === "empty");
  const baseline = new Set(keysOf(empty?.request));
  const reqs = (ids: string[]) => runs.filter((r) => ids.includes(r.id)).map((r) => r.request).filter((r): r is NetRequest => !!r);

  // ── Alan → parametre eşlemesi (tek-alan deneyleri) ──
  const fieldParams = new Map<string, string[]>();
  for (const r of runs) {
    if (!r.id.startsWith("single:")) continue;
    const field = Object.keys(r.filled)[0];
    if (!field) continue;
    const extra = minus(keysOf(r.request), baseline);
    if (r.request && extra.length > 0) fieldParams.set(field, extra);
  }

  // ── Boş arama: zorunlu filtre var mı? ──
  if (empty) {
    if (empty.request) {
      out.push(fact(screenPath, "required-field",
        "Hiçbir filtre girilmeden arama yapılabilir; sistem tüm kayıtları listeler.",
        { requests: [empty.request], ...(empty.stateLabel ? { stateLabels: [empty.stateLabel] } : {}), note: "boş arama isteği gönderildi" }, "high"));
    } else {
      out.push(fact(screenPath, "required-field",
        `Arama için en az bir filtre girilmesi gerekir; boş aramada istek gönderilmez${empty.message ? ` (uygulama mesajı: "${empty.message}")` : ""}.`,
        { ...(empty.stateLabel ? { stateLabels: [empty.stateLabel] } : {}), note: "boş aramada istek yok" }, empty.message ? "high" : "medium"));
    }
  }

  // ── Kombinasyon deneyleri: öncelik mi, birlikte mi? ──
  for (const r of runs) {
    if (!r.id.startsWith("combo:") || !r.request) continue;
    const fields = Object.keys(r.filled);
    if (fields.length < 2) continue;
    const [A, B] = fields as [string, string];
    const pa = fieldParams.get(A), pb = fieldParams.get(B);
    if (!pa || !pb) continue; // eşleme bilinmiyor → kural türetme (uydurma yok)
    const observed = minus(keysOf(r.request), baseline);
    const union = [...new Set([...pa, ...pb])];
    const ev = { requests: [...reqs([`single:${A}`, `single:${B}`]), r.request], ...(r.stateLabel ? { stateLabels: [r.stateLabel] } : {}) };
    if (same(observed, pa) && !same(pa, pb)) {
      out.push(fact(screenPath, "filter-precedence",
        `"${A}" alanı doluyken "${B}" filtresi isteğe dahil edilmez — ${A} ile arama diğer filtreyi geçersiz kılar.`,
        { ...ev, note: `A+B doluyken istekte yalnız ${pa.join(",")} var; ${pb.join(",")} yok` }, "high"));
    } else if (same(observed, pb) && !same(pa, pb)) {
      out.push(fact(screenPath, "filter-precedence",
        `"${B}" alanı doluyken "${A}" filtresi isteğe dahil edilmez — ${B} ile arama diğer filtreyi geçersiz kılar.`,
        { ...ev, note: `A+B doluyken istekte yalnız ${pb.join(",")} var; ${pa.join(",")} yok` }, "high"));
    } else if (same(observed, union)) {
      out.push(fact(screenPath, "filter-combine",
        `"${A}" ve "${B}" filtreleri birlikte kullanılabilir; ikisi de isteğe dahil edilir (daraltarak/AND).`,
        { ...ev, note: `A+B doluyken istekte ${union.join(",")} birlikte var` }, "high"));
    } else {
      out.push(fact(screenPath, "other",
        `"${A}" ve "${B}" birlikte girildiğinde istek parametreleri beklenenden farklı (${observed.join(",") || "yok"}); davranış ekranda doğrulanmalı.`,
        { ...ev, note: `beklenen ${union.join(",")} / gözlenen ${observed.join(",")}` }, "low"));
    }
  }

  // ── Geçersiz değer doğrulaması ── (kanıt yoksa kural YOK)
  for (const r of runs) {
    if (!r.id.startsWith("validation:")) continue;
    const field = Object.keys(r.filled)[0] ?? r.id.slice("validation:".length);
    if (r.message) {
      out.push(fact(screenPath, "validation",
        `"${field}" alanına geçersiz değer girildiğinde uygulama "${r.message}" uyarısı gösterir.`,
        { ...(r.stateLabel ? { stateLabels: [r.stateLabel] } : {}), note: "geçersiz değerle arama denendi, uyarı görüldü" }, "high"));
    } else if (!r.request) {
      out.push(fact(screenPath, "validation",
        `"${field}" alanına geçersiz değer girildiğinde arama gönderilmez (istemci tarafı doğrulama).`,
        { note: "geçersiz değerle arama denendi, istek gitmedi" }, "medium"));
    }
  }

  // ── Temizle/Reset ──
  const reset = runs.find((r) => r.id === "reset");
  if (reset && reset.request && same(minus(keysOf(reset.request), baseline), [])) {
    out.push(fact(screenPath, "other",
      "\"Temizle\" filtreleri sıfırlar; sonraki arama tüm kayıtları getirir.",
      { requests: [reset.request], ...(reset.stateLabel ? { stateLabels: [reset.stateLabel] } : {}) }, "high"));
  }

  // ── Sayfalama / sıralama (gözlenen anahtarlardan) ──
  const anyReq = runs.map((r) => r.request).find((r): r is NetRequest => !!r);
  if (anyReq) {
    const ks = keysOf(anyReq);
    const pg = ks.filter((k) => PAGINATION_KEYS.test(k));
    if (pg.length > 0) out.push(fact(screenPath, "pagination",
      `Liste sayfalama ile gelir; sayfa/boyut parametreleri isteğe eklenir (${pg.join(", ")}).`,
      { requests: [anyReq] }, "medium"));
    const so = ks.filter((k) => SORT_KEYS.test(k));
    if (so.length > 0) out.push(fact(screenPath, "sort",
      `Sıralama isteğe parametre olarak yansır (${so.join(", ")}); sütun başlığına tıklamak listeyi yeniden getirir.`,
      { requests: [anyReq] }, "medium"));
  }

  return out;
}
