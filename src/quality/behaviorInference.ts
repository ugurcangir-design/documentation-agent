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
import type { ScreenState } from "../types/screen";

export interface ProbeRun {
  /** "empty" | "single:<alan>" | "combo:<A>+<B>" | "reset" | serbest */
  id: string;
  /** Deneyde doldurulan alanlar (etiket → değer, maskeli). */
  filled: Record<string, string>;
  /** Deneyin tetiklediği arama isteği (yoksa istek gitmedi). */
  request?: NetRequest;
  /** Ekranda görülen uyarı/doğrulama mesajı (varsa). */
  message?: string;
  /** Boş deneyde okuma-submit butonu pasifti (zorunlu filtre için pozitif kanıt). */
  applyDisabled?: boolean;
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
  // NOT: "istek yok" tek başına kanıt DEĞİLDİR — filtreler zaten boşken
  // Apply çoğu uygulamada no-op'tur (refetch yok). Zorunlu-filtre kuralı için
  // POZİTİF kanıt gerekir: uyarı mesajı veya pasif buton. Aksi halde kural yok.
  if (empty) {
    if (empty.request) {
      out.push(fact(screenPath, "required-field",
        "Hiçbir filtre girilmeden arama yapılabilir; sistem tüm kayıtları listeler.",
        { requests: [empty.request], ...(empty.stateLabel ? { stateLabels: [empty.stateLabel] } : {}), note: "boş arama isteği gönderildi" }, "high"));
    } else if (empty.message || empty.applyDisabled) {
      out.push(fact(screenPath, "required-field",
        `Arama için en az bir filtre girilmesi gerekir${empty.applyDisabled ? "; filtre girilmeden arama butonu pasiftir" : ""}${empty.message ? ` (uygulama mesajı: "${empty.message}")` : ""}.`,
        { ...(empty.stateLabel ? { stateLabels: [empty.stateLabel] } : {}), note: empty.applyDisabled ? "boş formda arama butonu pasif" : "boş aramada uyarı mesajı" }, "high"));
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
    } else if (r.request && (r.request.status ?? 0) >= 400) {
      out.push(fact(screenPath, "validation",
        `"${field}" alanına geçersiz değer girildiğinde sunucu aramayı reddeder (HTTP ${r.request.status}); liste güncellenmez.`,
        { requests: [r.request], note: "geçersiz değerle arama gönderildi, sunucu 4xx döndü" }, "high"));
    }
    // "istek yok + mesaj yok" → kanıt değil (no-op olabilir) → kural yok.
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


/**
 * Deneyler çalışamasa bile (filtre yok / buton yok) keşifte yakalanan state
 * kanıtından güvenli kurallar türetir: sıralama, sayfalama, satır→detay
 * navigasyonu, satır "View" modalı. Yalnız KANIT varsa; uydurma yok.
 */
export function inferFromStateEvidence(screenPath: string, states: ScreenState[]): BehaviorFact[] {
  const out: BehaviorFact[] = [];
  const reqsOf = (s: ScreenState) => s.evidence?.requests ?? [];

  const sortStates = states.filter((s) => /^S[ıi]ralama:/i.test(s.label) && reqsOf(s).some((r) => Object.keys(r.query).some((k) => SORT_KEYS.test(k))));
  if (sortStates.length > 0) {
    const r = reqsOf(sortStates[0]!).find((q) => Object.keys(q.query).some((k) => SORT_KEYS.test(k)))!;
    const keys = Object.keys(r.query).filter((k) => SORT_KEYS.test(k));
    out.push(fact(screenPath, "sort",
      `Sütun başlığına tıklamak listeyi sunucudan yeniden getirir; sıralama ölçütü ve yönü isteğe parametre olarak eklenir (${keys.join(", ")}). Sıralanabilir sütunlar: ${sortStates.map((s) => s.label.replace(/^S[ıi]ralama:\s*"?|"?$/g, "")).slice(0, 6).join(", ")}.`,
      { stateLabels: sortStates.map((s) => s.label).slice(0, 6), requests: [r] }, "high"));
  }

  const pageReq = states.flatMap(reqsOf).find((r) => Object.keys(r.query).some((k) => PAGINATION_KEYS.test(k)));
  if (pageReq && !out.some((f) => f.kind === "pagination")) {
    const keys = Object.keys(pageReq.query).filter((k) => PAGINATION_KEYS.test(k));
    const size = pageReq.query["size"] ?? pageReq.query["pageSize"] ?? pageReq.query["limit"];
    out.push(fact(screenPath, "pagination",
      `Liste sayfalama ile gelir${size ? ` (sayfa başına ${size} kayıt)` : ""}; sayfa/boyut parametreleri isteğe eklenir (${keys.join(", ")}).`,
      { requests: [pageReq] }, "medium"));
  }

  const detail = states.find((s) => /^Kay[ıi]t detay ekran[ıi]/i.test(s.label) && reqsOf(s).some((r) => /\/[A-Za-z0-9-]{1,40}\/?$/.test(r.path)));
  if (detail) {
    const r = reqsOf(detail).find((q) => /\/[A-Za-z0-9-]{1,40}\/?$/.test(q.path))!;
    const tmpl = r.path.replace(/\/[A-Za-z0-9-]{1,40}\/?$/, "/{id}");
    out.push(fact(screenPath, "navigation",
      `Satırdaki kayıt kimliğine tıklamak o kaydın detay ekranını açar; detay verisi kayıt bazında sunucudan getirilir (${r.method} ${tmpl}).`,
      { stateLabels: [detail.label], requests: [r] }, "high"));
  }

  const rejected = states.find((s) => reqsOf(s).some((r) => (r.status ?? 0) >= 400 && (r.status ?? 0) < 500 && Object.keys(r.query).length > 0));
  if (rejected && !out.some((f) => f.kind === "validation")) {
    const r = reqsOf(rejected).find((q) => (q.status ?? 0) >= 400)!;
    out.push(fact(screenPath, "validation",
      `Arama, geçersiz/uyumsuz bir filtre değeri içerdiğinde sunucu isteği reddeder (HTTP ${r.status}) ve liste güncellenmez; alan formatlarına uyun.`,
      { stateLabels: [rejected.label], requests: [r], note: `parametreler: ${Object.keys(r.query).join(",")}` }, "medium"));
  }

  const view = states.find((s) => /^Modal:\s*"?(View|Görüntüle|Önizle|Detay)/i.test(s.label) && reqsOf(s).length > 0);
  if (view) {
    const r = reqsOf(view)[0]!;
    out.push(fact(screenPath, "navigation",
      `Satırdaki "${view.label.replace(/^Modal:\s*"?|"?\s*\(satır\)$/g, "")}" işlemi kaydın detayını modal pencerede açar (sunucudan ${r.method} ${r.path.replace(/\/[A-Za-z0-9-]{1,40}\/?$/, "/{id}")}).`,
      { stateLabels: [view.label], requests: [r] }, "high"));
  }
  return out;
}
