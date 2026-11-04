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

async function clearAll(fields: Field[]): Promise<void> {
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

/** Okuma-submit'e basıp bu etkileşimin tetiklediği "arama" isteğini döndürür. */
/** Okuma-submit'e basıp bu etkileşimin tetiklediği "arama" isteğini döndürür.
 *  `clicked:false` → okuma-submit butonu YOK (deneyler anlamsız → çağıran atlar);
 *  `clicked:true, request:undefined` → tıklandı ama istek gitmedi (kanıt!). */
async function submitAndCapture(page: Page, scope: Page | Locator, recorder: RequestRecorder, log: (m: string) => void): Promise<{ clicked: boolean; request?: NetRequest }> {
  recorder.reset();
  const r = await clickSubmitButton(page, scope, "read", log);
  if (!r.clicked) return { clicked: false };
  await page.waitForTimeout(1000);
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

  try {
    // empty
    if (can()) {
      await clearAll(fields);
      const { clicked, request } = await submitAndCapture(page, scope, recorder, log); used++;
      if (!clicked) {
        log("  (okuma-submit butonu yok — davranış deneyleri atlandı; kural uydurulmaz)");
        return [];
      }
      const message = request ? "" : await visibleMessage(page);
      runs.push({ id: "empty", filled: {}, ...(request ? { request } : {}), ...(message ? { message } : {}) });
    }
    // single A
    if (can()) {
      await clearAll(fields); await A.loc.fill(A.value, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log); used++;
      runs.push({ id: `single:${A.label}`, filled: { [A.label]: maskValue(A.label, A.value) }, ...(request ? { request } : {}) });
    }
    // single B + combo
    if (B && can()) {
      await clearAll(fields); await B.loc.fill(B.value, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log); used++;
      runs.push({ id: `single:${B.label}`, filled: { [B.label]: maskValue(B.label, B.value) }, ...(request ? { request } : {}) });
    }
    if (B && can()) {
      await clearAll(fields);
      await A.loc.fill(A.value, { timeout: 1500 }).catch(() => {});
      await B.loc.fill(B.value, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log); used++;
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
        const { request } = await submitAndCapture(page, scope, recorder, log); used++;
        runs.push({ id: "reset", filled: {}, ...(request ? { request } : {}) });
        break;
      }
    }
    // validation: A'ya geçersiz değer → uyarı mesajı var mı / istek gidiyor mu?
    if (can()) {
      await clearAll(fields);
      const atype = (await A.loc.getAttribute("type").catch(() => "")) || "";
      const bad = /number/i.test(atype) || ID_LIKE.test(A.label) ? "abc!" : "x".repeat(300);
      await A.loc.fill(bad, { timeout: 1500 }).catch(() => {});
      const { request } = await submitAndCapture(page, scope, recorder, log); used++;
      const message = await visibleMessage(page);
      runs.push({ id: `validation:${A.label}`, filled: { [A.label]: bad.slice(0, 12) }, ...(request ? { request } : {}), ...(message ? { message } : {}) });
    }
  } finally {
    await clearAll(fields);
    recorder.reset();
  }

  const facts = inferBehaviors(screenPath, runs);
  for (const f of facts) log(`  ✓ Davranış kuralı [${f.kind}/${f.confidence}]: ${f.statement}`);
  if (facts.length === 0) log("  (davranış deneylerinden kural türetilemedi)");
  return facts;
}
