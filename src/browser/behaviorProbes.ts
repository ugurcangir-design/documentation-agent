/**
 * Davranış deneyleri (Faz 2) — filtre/arama formlarında KONTROLLÜ, tekrarlanabilir
 * okuma-submit probe'ları çalıştırıp (yazma/kayıt ASLA yok) tetiklenen istekleri
 * `behaviorInference` ile kurala çevirir.
 *
 * Deney sırası (her biri bir okuma-submit = ek bir GET; sınır env.behaviorProbesMax):
 *   empty      → hiçbir alan dolu değil        (zorunlu filtre? taban çizgisi)
 *   single:A   → yalnız A (ID-benzeri öncelikli)
 *   single:B   → yalnız B
 *   combo:A+B  → A ve B birlikte              (öncelik mi, birlikte mi?)
 *   reset      → "Temizle" butonu varsa        (filtreleri sıfırlar mı?)
 * Her deney için istek kaydediciden alınır; A+B deneyi bir görsel state olarak da
 * kaydedilir (kılavuzda kanıt görseli). Deney sonunda alanlar temizlenir.
 */

import type { Page, Locator } from "playwright";
import { fieldMetaOf, sampleValueForField, clickSubmitButton } from "./formFiller";
import { maskValue, type RequestRecorder } from "./requestRecorder";
import { inferBehaviors, type ProbeRun } from "../quality/behaviorInference";
import { env } from "../config/env";
import type { BehaviorFact, NetRequest, StateEvidence } from "../types/behavior";
import type { CaptureOptions } from "./screenshotCapture";

type PushFn = (label: string, triggeredBy: string, filename: string, capture?: CaptureOptions, extra?: Partial<StateEvidence>) => Promise<void>;

const TEXT_SEL =
  'input[type="text"]:not([disabled]):not([readonly]), input[type="search"]:not([disabled]):not([readonly]), ' +
  'input[type="number"]:not([disabled]):not([readonly]), input:not([type]):not([disabled]):not([readonly])';
const ID_LIKE = /\b(id|kimlik|kod|code|no|numara|barkod|barcode)\b/i;
const CLEAR_BTN = /\b(temizle|clear|sıfırla|sifirla|reset)\b/i;
const MAX_FIELDS = 3;

interface Field { loc: Locator; label: string; value: string }

const FILTER_OPENERS = [
  'button:has-text("Filtreler")', 'button:has-text("Filtre")', 'button:has-text("Filters")', 'button:has-text("Filter")',
  '[role="button"]:has-text("Filtre")', '[role="button"]:has-text("Filter")',
  '[aria-label*="filter" i]', '[aria-label*="filtre" i]', '[class*="filter-header" i]', '[class*="FilterHeader"]',
  'div:has-text("Filters"):not(:has(div))',
];

/** Filtre alanları görünmüyorsa (panel daraltılmış) paneli AÇAR. Alan zaten
 *  görünüyorsa dokunmaz (toggle'ı yanlışlıkla kapatmamak için). */
export async function ensureFiltersOpen(page: Page, log: (m: string) => void): Promise<boolean> {
  try {
    if (await page.locator(TEXT_SEL).first().isVisible({ timeout: 400 }).catch(() => false)) return true;
    for (const sel of FILTER_OPENERS) {
      const ctrl = page.locator(sel).first();
      if (!(await ctrl.isVisible({ timeout: 300 }).catch(() => false))) continue;
      await ctrl.click({ timeout: 2000 }).catch(async () => { await ctrl.click({ timeout: 2000, force: true }).catch(() => {}); });
      await page.waitForTimeout(900);
      if (await page.locator(TEXT_SEL).first().isVisible({ timeout: 600 }).catch(() => false)) {
        log(`  ↳ Filtre paneli yeniden açıldı (${sel})`);
        return true;
      }
    }
  } catch { /* en-iyi-çaba */ }
  return false;
}

/**
 * Deney değerini TABLODAN alır: alan etiketiyle eşleşen sütun başlığının ilk
 * satırdaki hücresi (ör. "Retailer ID" → "4", "Barcode" → gerçek barkod).
 * Gerçek değer → geçerli istek (400 yok) → kesin alan→parametre eşlemesi.
 * String-evaluate: tsx/esbuild'in __name enjeksiyonundan kaçınmak için.
 */
export async function valueFromTable(page: Page, label: string): Promise<string | null> {
  try {
    const v = await page.evaluate(`((label) => {
      const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, " ").trim();
      const want = norm(label);
      if (!want) return null;
      const headers = Array.from(document.querySelectorAll('thead th, [role="columnheader"], thead td'));
      let idx = headers.findIndex((h) => norm(h.textContent) === want);
      if (idx < 0) idx = headers.findIndex((h) => norm(h.textContent).includes(want) || want.includes(norm(h.textContent)));
      if (idx < 0) return null;
      const row = document.querySelector("tbody tr");
      if (!row) return null;
      const cells = Array.from(row.querySelectorAll('td, [role="cell"]'));
      const cell = cells[idx];
      if (!cell) return null;
      const txt = (cell.textContent || "").replace(/\\s+/g, " ").trim();
      return txt && txt.length <= 40 ? txt : null;
    })(${JSON.stringify(label)})`) as string | null;
    return v && v !== "—" && v !== "-" ? v : null;
  } catch { return null; }
}

/** Boş arama sonrası (liste doluyken) deney değerlerini tablodaki gerçek
 *  değerlerle tazeler; bulunamazsa örnek değer kalır. */
async function refreshValuesFromTable(page: Page, fields: Field[], log: (m: string) => void): Promise<void> {
  for (const f of fields) {
    // "Search by retailer ID..." gibi ipuçlarından sütun adını çıkar.
    const colLabel = f.label.replace(/^search by\s+/i, "").replace(/\.{2,}$/, "").trim();
    const real = await valueFromTable(page, colLabel);
    if (real) f.value = real;
  }
  log(`  deney değerleri: ${fields.map((f) => `${f.label}=${maskValue(f.label, f.value)}`).join(", ")}`);
}

async function collectFields(scope: Page | Locator): Promise<Field[]> {
  const root = "locator" in scope ? (scope as Locator) : (scope as Page);
  const inputs = root.locator(TEXT_SEL);
  const n = await inputs.count().catch(() => 0);
  const out: Field[] = [];
  for (let i = 0; i < n && out.length < 8; i++) {
    const loc = inputs.nth(i);
    try {
      if (!(await loc.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const meta = await fieldMetaOf(loc);
      const label = (meta.label || meta.placeholder || meta.name || `alan ${i + 1}`).trim().slice(0, 40);
      const value = sampleValueForField(meta);
      if (!value) continue;
      out.push({ loc, label, value });
    } catch { /* atla */ }
  }
  // ID-benzeri alanlar öne (öncelik deneyi için A adayı), sonra sıra korunur.
  return out
    .map((f, i) => ({ f, i, id: ID_LIKE.test(f.label) ? 0 : 1 }))
    .sort((a, b) => a.id - b.id || a.i - b.i)
    .map((x) => x.f)
    .slice(0, MAX_FIELDS);
}

/** Kapsamdaki TÜM metin alanlarını temizler (yalnız deney alanlarını değil):
 *  keşif sırasında doldurulmuş diğer filtreler (ör. Device ID) deneyi kirletir —
 *  "boş" arama isteğinde fazladan parametre görünür, liste boş döner. */
async function clearAll(scope: Page | Locator, fields: Field[]): Promise<void> {
  const root = "locator" in scope ? (scope as Locator) : (scope as Page);
  try {
    const all = root.locator(TEXT_SEL);
    const n = Math.min(await all.count().catch(() => 0), 30);
    for (let i = 0; i < n; i++) {
      const loc = all.nth(i);
      const v = await loc.inputValue({ timeout: 300 }).catch(() => "");
      if (v) await loc.fill("", { timeout: 1000 }).catch(() => {});
    }
  } catch { /* noop */ }
  for (const f of fields) await f.loc.fill("", { timeout: 1500 }).catch(() => {});
}

async function visibleMessage(page: Page): Promise<string> {
  for (const sel of ['[role="alert"]', ".error", ".invalid-feedback", ".ant-form-item-explain-error", ".Toastify__toast", ".MuiAlert-message"]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
        const t = ((await el.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ");
        if (t) return t.slice(0, 160);
      }
    } catch { /* devam */ }
  }
  return "";
}

const APPLY_LABEL = /\b(apply|uygula|ara|arama|search|sorgula|listele|getir|filtrele|göster|bul)\b/i;
/** Yalnız panel BAŞLIĞI olabilecek etiketler (toggle) — submit değildir. */
const HEADER_ONLY = /^\s*(filters?|filtreler|filtre paneli|filter panel|gelişmiş filtre|advanced filters?)\s*$/i;

/**
 * Deneyler için "Apply/Ara" butonunu bulur: alan A'dan SONRA gelen, toggle
 * olmayan (aria-expanded yok), APPLY_LABEL ile eşleşen ilk görünür buton.
 * clickSubmitButton(page) sayfadaki İLK okuma-tipi butonu tıkladığından canlı
 * uygulamada "Filters" panel başlığına basıp paneli KAPATIYORDU (istek yok).
 */
async function findApplyButton(page: Page, anchor: Locator, log: (m: string) => void): Promise<Locator | null> {
  // Yol 0 — erişilebilir ad (textContent boş olsa da aria-label/iç metin yakalanır).
  try {
    const byRole = page.getByRole("button", { name: /^(apply|uygula|ara|arama|search|sorgula|filtrele|listele)$/i });
    const rn = await byRole.count().catch(() => 0);
    for (let i = 0; i < rn; i++) {
      const b = byRole.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      if ((await b.getAttribute("aria-expanded").catch(() => null)) !== null) continue;
      // Pasif olsa da DÖNDÜR: canlı uygulamalarda Apply filtre girilmeden pasiftir;
      // tıklama anında isDisabled kontrol edilir (boş deneyde zorunlu-filtre kanıtı).
      const dis = await b.isDisabled().catch(() => false);
      log(`  deney butonu (role): "${((await b.textContent().catch(() => "")) || "").trim().slice(0, 30)}"${dis ? " (şu an pasif)" : ""}`);
      return b;
    }
  } catch { /* yol 1'e düş */ }
  const btns = page.locator('button, [role="button"], input[type="submit"]');
  const n = await btns.count().catch(() => 0);
  const anchorHandle = await anchor.elementHandle().catch(() => null);
  let fallback: Locator | null = null;
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    try {
      if (!(await b.isVisible({ timeout: 200 }).catch(() => false))) continue;
      const label = (((await b.textContent().catch(() => "")) || (await b.getAttribute("value").catch(() => "")) ||
        (await b.getAttribute("aria-label").catch(() => "")) || "")).trim().replace(/\s+/g, " ").slice(0, 40);
      if (!label || HEADER_ONLY.test(label) || !APPLY_LABEL.test(label)) continue;
      if ((await b.getAttribute("aria-expanded").catch(() => null)) !== null) continue;
      let after = true;
      if (anchorHandle) {
        after = await b.evaluate((el, a) => !!((a as Element).compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), anchorHandle).catch(() => true);
      }
      if (after) { log(`  deney butonu: "${label}"`); return b; }
      if (!fallback) fallback = b;
    } catch { /* sonraki */ }
  }
  if (fallback) { log("  deney butonu (alanlardan önce): fallback"); return fallback; }
  // Tanı: neden bulunamadı? STRING evaluate — tsx/esbuild, fonksiyon argümanına
  // `__name` sarmalayıcısı enjekte edip tarayıcıda ReferenceError veriyordu.
  try {
    const dump = await page.evaluate(`(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const all = Array.from(document.querySelectorAll('button,[role="button"],input[type="submit"]'));
      const cand = all.filter((el) => /apply|uygula|\\bara\\b|search|filtre|filter|sorgula|listele/i.test(((el.textContent || "") + " " + (el.getAttribute("aria-label") || ""))));
      return { total: all.length, cand: cand.slice(0, 12).map((el) => el.tagName + '"' + (el.textContent || "").trim().slice(0, 24) + '" vis=' + vis(el) + ' dis=' + (el.disabled === true || el.getAttribute("aria-disabled") === "true") + ' exp=' + el.getAttribute("aria-expanded") + ' role=' + el.getAttribute("role")) };
    })()`) as { total: number; cand: string[] };
    log(`  deney butonu BULUNAMADI (taranan: ${n}, DOM toplam: ${dump.total}). Adaylar: ${dump.cand.join(" | ") || "(yok)"}`);
  } catch (e) {
    log(`  deney butonu BULUNAMADI (taranan: ${n}); tanı alınamadı: ${(e as Error).message}`);
  }
  return null;
}

/** Okuma-submit'e basıp bu etkileşimin tetiklediği "arama" isteğini döndürür. */
/** Okuma-submit'e basıp bu etkileşimin tetiklediği "arama" isteğini döndürür.
 *  `clicked:false` → okuma-submit butonu YOK (deneyler anlamsız → çağıran atlar);
 *  `clicked:true, request:undefined` → tıklandı ama istek gitmedi (kanıt!). */
async function submitAndCapture(page: Page, scope: Page | Locator, recorder: RequestRecorder, log: (m: string) => void, applyBtn?: Locator | null): Promise<{ clicked: boolean; disabled?: boolean; request?: NetRequest }> {
  recorder.reset();
  let clicked = false;
  if (applyBtn) {
    if (await applyBtn.isDisabled().catch(() => false)) return { clicked: false, disabled: true };
    clicked = await applyBtn.click({ timeout: 2000 }).then(() => true).catch(async () =>
      applyBtn.click({ timeout: 2000, force: true }).then(() => true).catch(() => false));
  }
  if (!clicked) {
    const r = await clickSubmitButton(page, scope, "read", log);
    clicked = r.clicked;
  }
  if (!clicked) return { clicked: false };
  await page.waitForTimeout(1500);
  try { await page.waitForLoadState("networkidle", { timeout: 3000 }); } catch { /* noop */ }
  const reqs = recorder.drain().filter((q) => q.resourceType === "xhr" || q.resourceType === "fetch" || q.resourceType === "other");
  // Parametre taşıyan son istek tercih edilir (arama isteği); yoksa sonuncusu.
  const withParams = reqs.filter((q) => Object.keys(q.query).length > 0 || (q.bodyKeys?.length ?? 0) > 0);
  const request = (withParams.length > 0 ? withParams : reqs).at(-1);
  return { clicked: true, ...(request ? { request } : {}) };
}

export async function runBehaviorProbes(
  page: Page,
  scope: Page | Locator,
  screenPath: string,
  basePath: string,
  log: (m: string) => void,
  recorder: RequestRecorder,
  pushState?: PushFn
): Promise<BehaviorFact[]> {
  if (!env.behaviorProbes) return [];
  let fields = await collectFields(scope);
  if (fields.length === 0 && (await ensureFiltersOpen(page, log))) fields = await collectFields(scope);
  if (fields.length === 0) { log("  (davranış deneyi: filtre alanı yok — atlandı)"); return []; }
  const maxRuns = env.behaviorProbesMax;
  const runs: ProbeRun[] = [];
  let used = 0;
  const can = () => used < maxRuns;
  const A = fields[0]!, B = fields[1];
  log(`Davranış deneyleri başlıyor: ${fields.map((f) => f.label).join(", ")} (maks ${maxRuns} arama)`);
  const applyBtn = await findApplyButton(page, A.loc, log);
  const applyInitiallyDisabled = applyBtn ? await applyBtn.isDisabled().catch(() => false) : false;
  if (!applyBtn) {
    // Apply yoksa clickSubmitButton(page) fallback'i panel BAŞLIĞINA basıp paneli
    // kapatıyor ve sonraki deneyleri zehirliyordu → deneyleri güvenle atla.
    log("  (arama/uygula butonu bulunamadı — davranış deneyleri atlandı; kural uydurulmaz)");
    return [];
  }
  // Her deney öncesi: panel kapanmışsa yeniden aç, alanları temizle.
  const prep = async () => {
    if (!(await A.loc.isVisible({ timeout: 300 }).catch(() => false))) await ensureFiltersOpen(page, log);
    await clearAll(scope, fields);
  };

  try {
    // empty
    if (can()) {
      await prep();
      // Alanlar boşken okuma-submit PASİF mi? (zorunlu-filtre için POZİTİF kanıt)
      const root = "locator" in scope ? (scope as Locator) : (scope as Page);
      let applyDisabled = false;
      try {
        const dis = root.locator('button[disabled], [role="button"][aria-disabled="true"]');
        const n = await dis.count().catch(() => 0);
        for (let i = 0; i < n; i++) {
          const t = ((await dis.nth(i).textContent().catch(() => "")) || "").trim();
          if (/\b(ara|arama|filtrele|uygula|apply|search|filter)\b/i.test(t)) { applyDisabled = true; break; }
        }
      } catch { /* noop */ }
      const res = await submitAndCapture(page, scope, recorder, log, applyBtn); used++;
      const { clicked, request } = res;
      if (res.disabled || applyInitiallyDisabled) applyDisabled = true;
      if (!clicked && !applyDisabled) {
        log("  (okuma-submit butonu yok — davranış deneyleri atlandı; kural uydurulmaz)");
        return [];
      }
      const message = request ? "" : await visibleMessage(page);
      runs.push({ id: "empty", filled: {}, ...(request ? { request } : {}), ...(message ? { message } : {}), ...(applyDisabled ? { applyDisabled: true } : {}) });
      // Liste artık filtresiz/dolu: tek-alan deneyleri için tablodan GERÇEK değer al
      // (örnek değer → 400 / boş sonuç → alan→parametre eşlemesi çıkarılamaz).
      await refreshValuesFromTable(page, fields, log);
    }
    // single A
    if (can()) {
      await prep(); await A.loc.fill(A.value, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log, applyBtn); used++;
      runs.push({ id: `single:${A.label}`, filled: { [A.label]: maskValue(A.label, A.value) }, ...(request ? { request } : {}) });
    }
    // single B + combo
    if (B && can()) {
      await prep(); await B.loc.fill(B.value, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log, applyBtn); used++;
      runs.push({ id: `single:${B.label}`, filled: { [B.label]: maskValue(B.label, B.value) }, ...(request ? { request } : {}) });
    }
    if (B && can()) {
      await prep();
      await A.loc.fill(A.value, { timeout: 1500 }).catch(() => {});
      await B.loc.fill(B.value, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log, applyBtn); used++;
      const filled = { [A.label]: maskValue(A.label, A.value), [B.label]: maskValue(B.label, B.value) };
      const stateLabel = `Davranış deneyi: "${A.label}" + "${B.label}" ile arama`;
      if (pushState) {
        await pushState(stateLabel, `deney: iki filtre birlikte dolduruldu ve arandı`, `${basePath}_probe_combo`, { fullPage: true },
          { formValues: filled, ...(request ? { requests: [request] } : {}) }).catch(() => {});
      }
      runs.push({ id: `combo:${A.label}+${B.label}`, filled, ...(request ? { request } : {}), stateLabel });
    }
    // reset ("Temizle")
    if (can()) {
      const root = "locator" in scope ? (scope as Locator) : (scope as Page);
      const btns = root.locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])');
      const n = await btns.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const t = ((await b.textContent().catch(() => "")) || "").trim();
        if (!CLEAR_BTN.test(t) || !(await b.isVisible({ timeout: 200 }).catch(() => false))) continue;
        await A.loc.fill(A.value, { timeout: 1500 }).catch(() => {});
        await b.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        const { request } = await submitAndCapture(page, scope, recorder, log, applyBtn); used++;
        runs.push({ id: "reset", filled: {}, ...(request ? { request } : {}) });
        break;
      }
    }
    // validation: A'ya geçersiz değer → uyarı mesajı var mı / istek gidiyor mu?
    if (can()) {
      await prep();
      const atype = (await A.loc.getAttribute("type").catch(() => "")) || "";
      const bad = /number/i.test(atype) || ID_LIKE.test(A.label) ? "abc!" : "x".repeat(300);
      await A.loc.fill(bad, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log, applyBtn); used++;
      const message = await visibleMessage(page);
      runs.push({ id: `validation:${A.label}`, filled: { [A.label]: bad.slice(0, 12) }, ...(request ? { request } : {}), ...(message ? { message } : {}) });
    }
  } finally {
    await clearAll(scope, fields);
    recorder.reset();
  }

  for (const r of runs) {
    const keys = r.request ? `${r.request.method} ${r.request.path}?${Object.keys(r.request.query).join(",")} → ${r.request.status ?? "?"}` : "istek yok";
    log(`  deney ${r.id}: ${keys}${r.message ? ` | mesaj: "${r.message}"` : ""}${r.applyDisabled ? " | buton pasif" : ""}`);
  }
  const facts = inferBehaviors(screenPath, runs);
  for (const f of facts) log(`  ✓ Davranış kuralı [${f.kind}/${f.confidence}]: ${f.statement}`);
  if (facts.length === 0) log("  (davranış deneylerinden kural türetilemedi)");
  return facts;
}
