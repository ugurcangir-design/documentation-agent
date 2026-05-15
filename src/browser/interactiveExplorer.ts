/**
 * Interactive screen explorer — simulates a test user.
 *
 * On a single page, finds and triggers safe interactive elements
 * (tabs, dropdowns, modal-opening buttons, expandable rows) and
 * captures the resulting UI state. Skips destructive actions
 * (delete, submit, save, confirm…) and navigation links.
 */

import type { Page, ElementHandle } from "playwright";
import { captureScreenshot } from "./screenshotCapture";
import type { ScreenState } from "../types/screen";

const DESTRUCTIVE_PATTERNS = [
  /\bsil\b/i, /\bkald[ıi]r/i, /delete/i, /remove/i,
  /\bgönder\b/i, /\bkaydet\b/i, /save/i, /submit/i,
  /\bonayla\b/i, /confirm/i, /\bevet\b/i, /\byes\b/i,
  /\btamam\b/i, /\bçıkış\b/i, /logout/i, /sign\s*out/i,
  /\bödeme\b/i, /payment/i, /\bsatın\s*al/i, /buy/i,
];

const MODAL_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.modal-open',
  '.modal.show',
  '.ant-modal',
  '.MuiDialog-root .MuiDialog-paper',
  '[class*="modal"]:not(.modal-backdrop)',
  '[class*="Modal"]:not([class*="Backdrop"])',
  '[class*="dialog"]',
];

const MAX_TABS = 6;
const MAX_BUTTONS = 6;
const MAX_DROPDOWNS = 4;
const MAX_DATE_PICKERS = 3;
const MAX_CHECKBOXES = 3;
const MAX_TOGGLES = 3;
const MAX_HELP_HOVERS = 3;
const MAX_INPUT_FOCUSES = 2;
const MAX_ACCORDIONS = 3;
const MAX_GENERIC_BUTTONS = 4;

const SHORT_TIMEOUT = 1500;
const RENDER_WAIT = 700;

function isDestructive(text: string): boolean {
  if (!text) return false;
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(text));
}

async function safeText(el: ElementHandle): Promise<string> {
  try {
    const t = await el.textContent({ timeout: 500 });
    return (t ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  } catch {
    return "";
  }
}

async function isVisible(el: ElementHandle): Promise<boolean> {
  try { return await el.isVisible({ timeout: 300 }); } catch { return false; }
}

async function modalIsOpen(page: Page): Promise<boolean> {
  for (const sel of MODAL_SELECTORS) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const first = page.locator(sel).first();
        if (await first.isVisible({ timeout: 200 })) return true;
      }
    } catch { /* noop */ }
  }
  return false;
}

async function closeModal(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  if (await modalIsOpen(page)) {
    // try a Close button
    const closeBtn = page.locator(
      'button[aria-label*="close" i], button[aria-label*="kapat" i], button:has-text("×"), .modal-close, .ant-modal-close'
    ).first();
    try {
      if (await closeBtn.isVisible({ timeout: 200 })) {
        await closeBtn.click({ timeout: 1000 });
        await page.waitForTimeout(300);
      }
    } catch { /* noop */ }
  }
  // Final fallback: reload to original state
  if (await modalIsOpen(page)) {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function findVisible(page: Page, selector: string, log: (m: string) => void, kind: string): Promise<ElementHandle[]> {
  let all: ElementHandle[] = [];
  try { all = await page.$$(selector); } catch { /* invalid selector */ }
  if (all.length === 0) {
    log(`  ${kind}: 0 element bulundu`);
    return [];
  }
  const visible: ElementHandle[] = [];
  for (const el of all) {
    if (await isVisible(el)) visible.push(el);
  }
  log(`  ${kind}: ${all.length} bulundu, ${visible.length} görünür`);
  return visible;
}

export async function exploreInteractiveStates(
  page: Page,
  basePath: string,
  onProgress?: (msg: string) => void
): Promise<ScreenState[]> {
  const states: ScreenState[] = [];
  const log = (m: string) => { onProgress?.(m); console.log(`    [explore] ${m}`); };

  // ── 0. Wait for the SPA to actually render its interactive content ──
  log("Sayfa içeriğinin yüklenmesi bekleniyor…");
  try {
    await page.waitForSelector(
      'button, a[href], input, select, [role="button"], [role="tab"]',
      { state: "visible", timeout: 8000 }
    );
  } catch {
    log("  (interaktif element gözlemlenemedi, yine de devam ediliyor)");
  }
  await page.waitForTimeout(1500);
  try {
    await page.waitForLoadState("networkidle", { timeout: 4000 });
  } catch { /* SPA may never reach networkidle */ }

  // ── 1. TABS ──────────────────────────────────────────────────────
  const tabs = await findVisible(
    page,
    [
      '[role="tab"]',
      '.ant-tabs-tab',
      '.MuiTab-root',
      '.nav-tabs > li > a',
      '.nav-tabs > li > button',
      'ul[class*="tabs" i] > li',
      'ul[class*="Tabs"] > li',
      '[class*="tab-button"]',
      '[class*="TabButton"]',
      '[data-testid*="tab" i]',
    ].join(", "),
    log,
    "Tab"
  );
  let tabsClicked = 0;
  for (const tab of tabs) {
    if (tabsClicked >= MAX_TABS) break;
    const label = await safeText(tab);
    if (!label || isDestructive(label)) continue;

    try {
      await tab.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await tab.click({ timeout: SHORT_TIMEOUT });
      await page.waitForTimeout(RENDER_WAIT);

      const shot = await captureScreenshot(page, `${basePath}_tab_${tabsClicked}`);
      states.push({
        label: `Sekme: "${label}"`,
        triggeredBy: `tab tıklandı: ${label}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Sekme yakalandı: ${label}`);
      tabsClicked++;
    } catch (err) {
      log(`  × Sekme tıklanamadı: ${label} — ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 2. DROPDOWNS / SELECTS ───────────────────────────────────────
  const dropdowns = await findVisible(
    page,
    [
      'select:not([disabled])',
      '[aria-haspopup="true"]',
      '[aria-haspopup="menu"]',
      '[aria-haspopup="listbox"]',
      '[aria-haspopup="dialog"][role="button"]',
      '.ant-dropdown-trigger',
      '.ant-select-selector',
      '.MuiSelect-select',
      '[class*="dropdown-trigger" i]',
      '[class*="DropdownTrigger"]',
      '[class*="select-trigger" i]',
      'button[aria-expanded="false"]',
    ].join(", "),
    log,
    "Dropdown"
  );
  let dropdownsClicked = 0;
  for (const dd of dropdowns) {
    if (dropdownsClicked >= MAX_DROPDOWNS) break;
    const label = await safeText(dd);
    if (isDestructive(label)) continue;

    try {
      await dd.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await dd.click({ timeout: SHORT_TIMEOUT });
      await page.waitForTimeout(RENDER_WAIT);

      const shot = await captureScreenshot(page, `${basePath}_dd_${dropdownsClicked}`);
      states.push({
        label: `Dropdown açık: "${label || "menü"}"`,
        triggeredBy: `dropdown tıklandı: ${label || "(etiketsiz)"}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Dropdown yakalandı: ${label || "(etiketsiz)"}`);
      dropdownsClicked++;

      // Close it
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    } catch (err) {
      log(`  × Dropdown atlandı: ${label} — ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // Track clicked buttons to avoid re-clicking in fallback pass
  const clickedButtons = new Set<string>();

  // ── 3. BUTTONS THAT OPEN MODALS ──────────────────────────────────
  const buttons = await findVisible(
    page,
    'button:not([disabled]), [role="button"]:not([disabled]), [class*="Button"]:not([disabled])',
    log,
    "Buton"
  );
  let modalsCaptured = 0;
  for (const btn of buttons) {
    if (modalsCaptured >= MAX_BUTTONS) break;
    const label = await safeText(btn);
    if (label) clickedButtons.add(label);
    if (!label) continue;
    if (label.length < 2 || label.length > 35) continue;
    if (isDestructive(label)) continue;

    try {
      await btn.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await btn.click({ timeout: SHORT_TIMEOUT });
      await page.waitForTimeout(RENDER_WAIT + 400);

      if (await modalIsOpen(page)) {
        const shot = await captureScreenshot(page, `${basePath}_modal_${modalsCaptured}`);
        states.push({
          label: `Modal: "${label}"`,
          triggeredBy: `buton tıklandı: ${label}`,
          screenshotPath: shot.screenshotPath,
          screenshotBase64: shot.screenshotBase64,
        });
        log(`  ✓ Modal yakalandı: ${label}`);
        modalsCaptured++;
        await closeModal(page);
        await page.waitForTimeout(300);
      }
    } catch (err) {
      log(`  × Buton atlandı: ${label} — ${(err as Error).message.split("\n")[0]}`);
      await closeModal(page);
    }
  }

  // ── 4. DATE PICKERS ──────────────────────────────────────────────
  const dateInputs = await findVisible(
    page,
    [
      'input[type="date"]',
      'input[type="datetime-local"]',
      'input[type="month"]',
      'input[type="week"]',
      '[class*="DatePicker"]',
      '[class*="date-picker"]',
      '[class*="datepicker"]',
      '[data-testid*="date" i]',
      '[aria-label*="tarih" i]',
      '[aria-label*="date" i]',
    ].join(", "),
    log,
    "Tarih seçici"
  );
  let dpClicked = 0;
  for (const dp of dateInputs) {
    if (dpClicked >= MAX_DATE_PICKERS) break;
    const label = await safeText(dp);

    try {
      await dp.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await dp.click({ timeout: SHORT_TIMEOUT });
      await page.waitForTimeout(900);

      const shot = await captureScreenshot(page, `${basePath}_date_${dpClicked}`);
      states.push({
        label: `Tarih seçici açık: "${label || "tarih alanı"}"`,
        triggeredBy: `tarih input tıklandı: ${label || "(etiketsiz)"}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Tarih seçici yakalandı: ${label || "(etiketsiz)"}`);
      dpClicked++;

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
    } catch (err) {
      log(`  × Tarih seçici atlandı: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 5. CHECKBOXES (toggle + revert) ──────────────────────────────
  const checkboxes = await findVisible(
    page,
    'input[type="checkbox"]:not([disabled]):not([readonly]), [role="checkbox"]:not([aria-disabled="true"]), [class*="Checkbox"]:not([disabled])',
    log,
    "Checkbox"
  );
  let cbClicked = 0;
  for (const cb of checkboxes) {
    if (cbClicked >= MAX_CHECKBOXES) break;
    const label = await safeText(cb);

    try {
      const wasChecked = await cb.isChecked().catch(() => false);
      await cb.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await cb.click({ timeout: SHORT_TIMEOUT, force: true });
      await page.waitForTimeout(400);

      const shot = await captureScreenshot(page, `${basePath}_cb_${cbClicked}`);
      states.push({
        label: `Checkbox ${wasChecked ? "kaldırıldı" : "işaretlendi"}: "${label || "(etiketsiz)"}"`,
        triggeredBy: `checkbox toggle: ${label || "(etiketsiz)"}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Checkbox yakalandı: ${label || "(etiketsiz)"}`);
      cbClicked++;

      // Revert
      await cb.click({ timeout: SHORT_TIMEOUT, force: true }).catch(() => {});
      await page.waitForTimeout(200);
    } catch (err) {
      log(`  × Checkbox atlandı: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 6. TOGGLE SWITCHES (flip + revert) ───────────────────────────
  const toggles = await findVisible(
    page,
    [
      '[role="switch"]:not([aria-disabled="true"])',
      '.ant-switch:not(.ant-switch-disabled)',
      '.MuiSwitch-root input[type="checkbox"]',
      '[class*="toggle-switch" i]:not(button)',
      '[class*="Toggle"][role="button"]',
      '[class*="Switch"][role="button"]',
    ].join(", "),
    log,
    "Toggle"
  );
  let tgClicked = 0;
  for (const tg of toggles) {
    if (tgClicked >= MAX_TOGGLES) break;
    const label = await safeText(tg);

    try {
      await tg.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await tg.click({ timeout: SHORT_TIMEOUT, force: true });
      await page.waitForTimeout(500);

      const shot = await captureScreenshot(page, `${basePath}_toggle_${tgClicked}`);
      states.push({
        label: `Toggle değişti: "${label || "switch"}"`,
        triggeredBy: `toggle switch tıklandı: ${label || "(etiketsiz)"}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Toggle yakalandı: ${label || "(etiketsiz)"}`);
      tgClicked++;

      await tg.click({ timeout: SHORT_TIMEOUT, force: true }).catch(() => {});
      await page.waitForTimeout(200);
    } catch (err) {
      log(`  × Toggle atlandı: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 7. TEXT INPUT FOCUS (reveal labels/validation/hints) ─────────
  const textInputs = await findVisible(
    page,
    [
      'input[type="text"]:not([disabled]):not([readonly])',
      'input[type="search"]:not([disabled])',
      'input[type="email"]:not([disabled])',
      'input[type="number"]:not([disabled])',
      'input[type="tel"]:not([disabled])',
      'input[type="url"]:not([disabled])',
      'input:not([type]):not([disabled])',
      'textarea:not([disabled]):not([readonly])',
    ].join(", "),
    log,
    "Text input"
  );
  let inputFocused = 0;
  for (const inp of textInputs) {
    if (inputFocused >= MAX_INPUT_FOCUSES) break;
    const label = await safeText(inp);

    try {
      await inp.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await inp.focus({ timeout: SHORT_TIMEOUT });
      await page.waitForTimeout(500);

      const shot = await captureScreenshot(page, `${basePath}_input_${inputFocused}`);
      states.push({
        label: `Input focus state: "${label || "metin alanı"}"`,
        triggeredBy: `input focus: ${label || "(etiketsiz)"}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Input focus yakalandı: ${label || "(etiketsiz)"}`);
      inputFocused++;

      await inp.evaluate((el: HTMLElement) => el.blur()).catch(() => {});
    } catch (err) {
      log(`  × Input atlandı: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 8. HELP / INFO ICONS (hover for tooltips) ────────────────────
  const helpIcons = await findVisible(
    page,
    [
      '[aria-label*="info" i]',
      '[aria-label*="help" i]',
      '[aria-label*="yardım" i]',
      '[aria-label*="bilgi" i]',
      '[class*="info-icon" i]',
      '[class*="InfoIcon"]',
      '[class*="help-icon" i]',
      '[class*="HelpIcon"]',
      '[class*="question" i]',
      '[data-tooltip]',
      '[title]:not(a):not(button):not(html):not(body)',
    ].join(", "),
    log,
    "Yardım icon"
  );
  let hovered = 0;
  for (const icon of helpIcons) {
    if (hovered >= MAX_HELP_HOVERS) break;

    try {
      await icon.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await icon.hover({ timeout: SHORT_TIMEOUT });
      await page.waitForTimeout(900);

      const shot = await captureScreenshot(page, `${basePath}_hover_${hovered}`);
      states.push({
        label: `Tooltip: yardım icon'u hover`,
        triggeredBy: `hover on info/help icon`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Tooltip yakalandı`);
      hovered++;

      // Move mouse away to dismiss tooltip
      await page.mouse.move(0, 0).catch(() => {});
      await page.waitForTimeout(200);
    } catch (err) {
      log(`  × Hover atlandı: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 9. ACCORDIONS / EXPANDABLE SECTIONS ──────────────────────────
  const accordions = await findVisible(
    page,
    [
      'details > summary',
      '[aria-expanded="false"][role="button"]',
      '[aria-expanded="false"][class*="accordion" i]',
      '[class*="accordion-header" i]',
      '[class*="AccordionHeader"]',
      '[class*="Collapse"][role="button"]',
      '[class*="collapsible" i]',
    ].join(", "),
    log,
    "Accordion"
  );
  let accClicked = 0;
  for (const ac of accordions) {
    if (accClicked >= MAX_ACCORDIONS) break;
    const label = await safeText(ac);

    try {
      await ac.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
      await ac.click({ timeout: SHORT_TIMEOUT, force: true });
      await page.waitForTimeout(500);

      const shot = await captureScreenshot(page, `${basePath}_acc_${accClicked}`);
      states.push({
        label: `Accordion açık: "${label || "bölüm"}"`,
        triggeredBy: `accordion tıklandı: ${label || "(etiketsiz)"}`,
        screenshotPath: shot.screenshotPath,
        screenshotBase64: shot.screenshotBase64,
      });
      log(`  ✓ Accordion yakalandı: ${label || "(etiketsiz)"}`);
      accClicked++;
    } catch (err) {
      log(`  × Accordion atlandı: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ── 10. GENERIC BUTTON FALLBACK ──────────────────────────────────
  // If we got very few states, try clicking any unclicked text-bearing
  // button to find more states (any UI change counts).
  if (states.length < 3) {
    log("Az state yakalandı, generic buton taraması yapılıyor…");
    const allBtns = await findVisible(
      page,
      'button:not([disabled]), [role="button"]:not([aria-disabled="true"])',
      log,
      "Buton (fallback)"
    );
    const beforeCount = states.length;
    for (const btn of allBtns) {
      if (states.length - beforeCount >= MAX_GENERIC_BUTTONS) break;
      const label = await safeText(btn);
      if (!label || label.length < 2 || label.length > 35) continue;
      if (isDestructive(label)) continue;
      if (clickedButtons.has(label)) continue;
      clickedButtons.add(label);

      try {
        // Snapshot before
        const beforeUrl = page.url();

        await btn.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT });
        await btn.click({ timeout: SHORT_TIMEOUT });
        await page.waitForTimeout(800);

        const afterUrl = page.url();
        if (afterUrl !== beforeUrl) {
          // Navigated — go back, skip
          await page.goBack({ timeout: SHORT_TIMEOUT }).catch(() => {});
          await page.waitForTimeout(500);
          continue;
        }

        const shot = await captureScreenshot(page, `${basePath}_btn_${states.length}`);
        states.push({
          label: `Buton sonrası: "${label}"`,
          triggeredBy: `generic buton tıklandı: ${label}`,
          screenshotPath: shot.screenshotPath,
          screenshotBase64: shot.screenshotBase64,
        });
        log(`  ✓ Buton state yakalandı: ${label}`);

        // Try to close any modal that may have opened
        if (await modalIsOpen(page)) await closeModal(page);
      } catch {
        // ignore
      }
    }
  }

  log(`Toplam ${states.length} ek state yakalandı.`);
  return states;
}
