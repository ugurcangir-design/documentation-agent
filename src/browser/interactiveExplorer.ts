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

export async function exploreInteractiveStates(
  page: Page,
  basePath: string,
  onProgress?: (msg: string) => void
): Promise<ScreenState[]> {
  const states: ScreenState[] = [];
  const log = (m: string) => { onProgress?.(m); console.log(`    [explore] ${m}`); };

  // ── 1. TABS ──────────────────────────────────────────────────────
  log("Tablar aranıyor…");
  const tabs = await page.$$('[role="tab"], .ant-tabs-tab, .MuiTab-root, .nav-tabs > li > a, [class*="tab"][class*="active"], [class*="Tab-"]');
  let tabsClicked = 0;
  for (const tab of tabs) {
    if (tabsClicked >= MAX_TABS) break;
    if (!(await isVisible(tab))) continue;
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
  log("Dropdownlar/menüler aranıyor…");
  const dropdowns = await page.$$(
    '[aria-haspopup="true"][role="button"]:not([disabled]), [aria-haspopup="menu"], [aria-haspopup="listbox"], .ant-dropdown-trigger, button[aria-expanded="false"]'
  );
  let dropdownsClicked = 0;
  for (const dd of dropdowns) {
    if (dropdownsClicked >= MAX_DROPDOWNS) break;
    if (!(await isVisible(dd))) continue;
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

  // ── 3. BUTTONS THAT OPEN MODALS ──────────────────────────────────
  log("Modal/dialog açan butonlar aranıyor…");
  const buttons = await page.$$('button:not([disabled]), [role="button"]:not([disabled])');
  let modalsCaptured = 0;
  for (const btn of buttons) {
    if (modalsCaptured >= MAX_BUTTONS) break;
    if (!(await isVisible(btn))) continue;
    const label = await safeText(btn);
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

  log(`Toplam ${states.length} ek state yakalandı.`);
  return states;
}
