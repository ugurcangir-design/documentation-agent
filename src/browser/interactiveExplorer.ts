/**
 * Interactive screen explorer — simulates a test user.
 *
 * Uses Playwright Locator API throughout (re-queries DOM on each access),
 * which survives React/Vue/Svelte re-renders. Restricts most interactions
 * to the page's main content area so we don't accidentally click sidebar
 * navigation items.
 */

import type { Page, Locator } from "playwright";
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
  '[role="dialog"]', '[role="alertdialog"]',
  '.modal-open', '.modal.show',
  '.ant-modal', '.MuiDialog-paper',
  '[class*="modal"]:not(.modal-backdrop)',
  '[class*="Modal"]:not([class*="Backdrop"])',
  '[class*="dialog"]',
];

const MAX = {
  tabs: 6, dropdowns: 5, modals: 10, dates: 4,
  checkboxes: 4, toggles: 3, inputs: 4, hovers: 5,
  accordions: 3, fallback: 6,
  columns: 4, rowActions: 3,
};

const RENDER_WAIT = 700;
const ACTION_TIMEOUT = 2000;

function isDestructive(text: string): boolean {
  if (!text) return false;
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(text));
}

async function safeText(loc: Locator): Promise<string> {
  try {
    const t = await loc.textContent({ timeout: 500 });
    return (t ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  } catch { return ""; }
}

async function isInNavOrSidebar(loc: Locator): Promise<boolean> {
  try {
    return await loc.evaluate((el: Element) => {
      return Boolean(
        el.closest(
          'aside, nav, [role="navigation"], [class*="sidebar" i], ' +
            '[class*="Sidebar"], [class*="side-nav" i], [class*="SideNav"]'
        )
      );
    });
  } catch { return false; }
}

async function modalIsOpen(page: Page): Promise<boolean> {
  for (const sel of MODAL_SELECTORS) {
    try {
      const first = page.locator(sel).first();
      if (await first.isVisible({ timeout: 200 })) return true;
    } catch { /* noop */ }
  }
  return false;
}

async function closeModal(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  if (!(await modalIsOpen(page))) return;

  const closeBtn = page.locator(
    'button[aria-label*="close" i], button[aria-label*="kapat" i], ' +
      '.modal-close, .ant-modal-close, [class*="CloseIcon"]'
  ).first();
  try {
    if (await closeBtn.isVisible({ timeout: 300 })) {
      await closeBtn.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(300);
    }
  } catch { /* noop */ }

  if (await modalIsOpen(page)) {
    await page.keyboard.press("Escape").catch(() => {});
  }
}

/** Iterate visible locators up to a limit. Re-queries the locator on each
 *  iteration so React re-renders don't stale handles. */
async function forEachVisible(
  page: Page,
  selector: string,
  limit: number,
  log: (m: string) => void,
  kind: string,
  excludeNav: boolean,
  action: (loc: Locator, label: string, i: number) => Promise<boolean>
): Promise<number> {
  const root = page.locator(selector);
  const total = await root.count();
  let visible = 0;
  // First pass: count visible
  for (let i = 0; i < total; i++) {
    if (await root.nth(i).isVisible().catch(() => false)) visible++;
  }
  log(`  ${kind}: ${total} bulundu, ${visible} görünür`);

  let captured = 0;
  for (let i = 0; i < total; i++) {
    if (captured >= limit) break;

    // Re-query each iteration in case DOM changed
    const loc = page.locator(selector).nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    if (excludeNav && (await isInNavOrSidebar(loc))) continue;

    const label = await safeText(loc);
    if (isDestructive(label)) continue;

    try {
      const ok = await action(loc, label, i);
      if (ok) captured++;
    } catch (err) {
      log(`  × ${kind} atlandı: ${label || "(etiketsiz)"} — ${(err as Error).message.split("\n")[0]}`);
    }
  }
  return captured;
}

// Keywords that strongly suggest a button opens a modal / form / panel.
// Buttons whose label matches these are explored FIRST.
const MODAL_KEYWORDS = [
  "add", "yeni", "ekle", "oluştur", "create", "new",
  "edit", "düzenle", "detay", "detail", "görüntüle", "view",
  "filter", "filtre", "search", "ara", " + ", "(+)",
  "log", "kayıt", "history", "geçmiş", "ayar", "settings",
  "info", "bilgi", "aç", "open", "import", "export", "dışa", "içe",
  "manual", "manuel",
];

const PRIORITY_RE = new RegExp(
  MODAL_KEYWORDS.map((k) => k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i"
);

// Labels that are pagination / not worth a modal probe.
function isPaginationOrNoise(label: string): boolean {
  const l = label.trim();
  if (/^[0-9]+$/.test(l)) return true;                  // page numbers
  if (/^[‹›«»<>|–—.\s]+$/.test(l)) return true;          // arrows / separators
  if (l.length < 2) return true;
  return false;
}

/**
 * Priority-ordered action-button exploration. Collects every button in
 * the main content, scores each (modal-keyword labels rank highest),
 * skips column headers + pagination, then clicks the top MAX.modals.
 */
async function runActionButtonPass(
  page: Page,
  basePath: string,
  log: (m: string) => void,
  clickedLabels: Set<string>,
  pushState: (label: string, triggeredBy: string, filename: string) => Promise<void>
): Promise<void> {
  const root = page.locator(
    'button:not([disabled]), [role="button"]:not([aria-disabled="true"])'
  );
  const total = await root.count();

  // Collect candidates with metadata
  interface Candidate { index: number; label: string; priority: number }
  const candidates: Candidate[] = [];

  for (let i = 0; i < total; i++) {
    const loc = root.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    if (await isInNavOrSidebar(loc)) continue;

    // Skip column-header buttons (handled by the column-header pass)
    const inThead = await loc
      .evaluate((el: Element) => Boolean(el.closest("thead, th")))
      .catch(() => false);
    if (inThead) continue;
    // Skip buttons inside table rows (handled by the row-action pass)
    const inTbodyRow = await loc
      .evaluate((el: Element) => Boolean(el.closest("tbody tr, [role=\"row\"]")))
      .catch(() => false);
    if (inTbodyRow) continue;

    const label = await safeText(loc);
    if (!label || label.length > 35) continue;
    if (isDestructive(label)) continue;
    if (isPaginationOrNoise(label)) continue;
    if (clickedLabels.has(label)) continue;

    const priority = PRIORITY_RE.test(label) ? 2 : 1;
    candidates.push({ index: i, label, priority });
  }

  // Highest priority first; preserve DOM order within a tier
  candidates.sort((a, b) => b.priority - a.priority || a.index - b.index);

  log(`  Action-button: ${total} buton, ${candidates.length} aday (${candidates.filter((c) => c.priority === 2).length} öncelikli)`);

  let captured = 0;
  for (const cand of candidates) {
    if (captured >= MAX.modals) break;
    if (clickedLabels.has(cand.label)) continue;
    clickedLabels.add(cand.label);

    const loc = root.nth(cand.index);
    if (!(await loc.isVisible().catch(() => false))) continue;

    const beforeUrl = page.url();
    try {
      await loc.click({ timeout: ACTION_TIMEOUT });
    } catch {
      try { await loc.click({ timeout: ACTION_TIMEOUT, force: true }); }
      catch { await loc.evaluate((el: HTMLElement) => el.click()).catch(() => {}); }
    }
    await page.waitForTimeout(RENDER_WAIT + 300);

    if (page.url() !== beforeUrl) {
      await page.goBack({ timeout: ACTION_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }

    const isModal = await modalIsOpen(page);
    const kind = isModal ? "Modal" : "Panel/etki";
    await pushState(`${kind}: "${cand.label}"`, `buton tıklandı: ${cand.label}`, `${basePath}_btn_${cand.index}`);
    log(`  ✓ ${kind} yakalandı: ${cand.label}${cand.priority === 2 ? " (öncelikli)" : ""}`);
    captured++;

    // Sub-explore: focus a field inside the open modal/panel
    try {
      const subInputs = page.locator(
        'input[type="date"]:visible, input[type="datetime-local"]:visible, ' +
        'input[type="text"]:not([disabled]):not([readonly]):visible, ' +
        'input[type="search"]:visible, ' +
        '[class*="DatePicker"]:visible, [role="combobox"]:visible'
      );
      if ((await subInputs.count()) > 0) {
        const sub = subInputs.first();
        await sub.focus({ timeout: 1500 }).catch(async () => {
          await sub.click({ timeout: 1500, force: true }).catch(() => {});
        });
        await page.waitForTimeout(600);
        await pushState(
          `${kind} içi alan: "${cand.label}"`,
          `${kind} açıkken alt alan focus`,
          `${basePath}_btn_${cand.index}_inner`
        );
        log(`  ↳ ${kind} içi state yakalandı`);
      }
    } catch { /* noop */ }

    if (isModal) {
      await closeModal(page);
    } else {
      await page.keyboard.press("Escape").catch(() => {});
    }
    await page.waitForTimeout(300);
  }
}

export async function exploreInteractiveStates(
  page: Page,
  basePath: string,
  onProgress?: (msg: string) => void
): Promise<ScreenState[]> {
  const states: ScreenState[] = [];
  const log = (m: string) => { onProgress?.(m); console.log(`    [explore] ${m}`); };
  const clickedLabels = new Set<string>();

  // Wait for SPA to render its interactive content
  log("Sayfa içeriği bekleniyor…");
  try {
    await page.waitForSelector(
      'button, a[href], input, select, [role="button"], [role="tab"]',
      { state: "visible", timeout: 8000 }
    );
  } catch {
    log("  (interaktif element gözlenemedi, devam ediyoruz)");
  }
  await page.waitForTimeout(1500);
  try { await page.waitForLoadState("networkidle", { timeout: 4000 }); } catch { /* noop */ }

  const pushState = async (label: string, triggeredBy: string, filename: string) => {
    const shot = await captureScreenshot(page, filename);
    states.push({
      label,
      triggeredBy,
      screenshotPath: shot.screenshotPath,
      screenshotBase64: shot.screenshotBase64,
    });
  };

  // ── 0. PRE-PASS: open the Filters/Search panel first ─────────────
  // The filter trigger is often NOT a <button> — it can be a div/span
  // with an icon, a clickable header, or an [aria-expanded] toggle.
  let filterOpened = false;
  for (const sel of [
    'button:has-text("Filtreler")', 'button:has-text("Filtre")',
    'button:has-text("Filters")', 'button:has-text("Filter")',
    'button:has-text("Ara")', 'button:has-text("Search")',
    '[role="button"]:has-text("Filtre")', '[role="button"]:has-text("Filter")',
    '[aria-label*="filter" i]', '[aria-label*="filtre" i]',
    '[class*="filter" i][role="button"]',
    '[class*="Filter"][class*="toggle" i]',
    '[class*="filter-header" i]', '[class*="FilterHeader"]',
    '[data-testid*="filter" i]',
    // Clickable element directly containing the word "Filter(s)"
    'div:has-text("Filters"):not(:has(div))',
  ]) {
    try {
      const ctrl = page.locator(sel).first();
      if (!(await ctrl.isVisible({ timeout: 400 }))) continue;
      if (await isInNavOrSidebar(ctrl)) continue;
      const lbl = (await safeText(ctrl)) || "Filter";
      log(`Pre-pass: Filtre paneli açılıyor (${lbl}) — selector: ${sel}`);
      await ctrl.click({ timeout: ACTION_TIMEOUT }).catch(async () => {
        await ctrl.click({ timeout: ACTION_TIMEOUT, force: true });
      });
      await page.waitForTimeout(900);
      await pushState(`Filtre paneli açık`, `Filtre kontrolü tıklandı (${lbl})`, `${basePath}_filters_open`);
      log(`  ✓ Filtre paneli yakalandı`);
      clickedLabels.add(lbl);
      filterOpened = true;
      break;
    } catch { /* try next */ }
  }
  if (!filterOpened) {
    log("  ⚠ Filtre paneli açan kontrol bulunamadı — filtre alanı zaten açık olabilir");
  }

  // ── 1. TABS ──────────────────────────────────────────────────────
  await forEachVisible(
    page,
    [
      '[role="tab"]', '.ant-tabs-tab', '.MuiTab-root',
      '.nav-tabs > li > a', '.nav-tabs > li > button',
      'ul[class*="tabs" i] > li', 'ul[class*="Tabs"] > li',
      '[class*="tab-button"]', '[class*="TabButton"]',
      '[class*="segment" i][role="button"]',
      '[class*="SegmentedControl"] button',
      '[class*="ButtonGroup"] button[aria-pressed]',
      '.btn-group > button',
      '[data-testid*="tab" i]',
    ].join(", "),
    MAX.tabs, log, "Tab", false,
    async (loc, label, i) => {
      if (clickedLabels.has(label)) return false;
      await loc.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(RENDER_WAIT);
      await pushState(`Sekme: "${label || `tab ${i}`}"`, `tab tıklandı: ${label}`, `${basePath}_tab_${i}`);
      clickedLabels.add(label);
      log(`  ✓ Sekme yakalandı: ${label}`);
      return true;
    }
  );

  // ── 2. DROPDOWNS / SELECTS ───────────────────────────────────────
  await forEachVisible(
    page,
    [
      'select:not([disabled])',
      '[aria-haspopup="true"]',
      '[aria-haspopup="menu"]',
      '[aria-haspopup="listbox"]',
      '[aria-haspopup="dialog"][role="button"]',
      '.ant-dropdown-trigger', '.ant-select-selector',
      '.MuiSelect-select',
      '[class*="dropdown-trigger" i]', '[class*="DropdownTrigger"]',
      '[class*="select-trigger" i]',
    ].join(", "),
    MAX.dropdowns, log, "Dropdown", true,
    async (loc, label, i) => {
      await loc.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(RENDER_WAIT);
      await pushState(
        `Dropdown açık: "${label || `dropdown ${i}`}"`,
        `dropdown tıklandı: ${label || "(etiketsiz)"}`,
        `${basePath}_dd_${i}`
      );
      log(`  ✓ Dropdown yakalandı: ${label || "(etiketsiz)"}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  );

  // ── 3. ACTION BUTTONS (priority-ordered) ─────────────────────────
  // Modal-opening buttons (Add / Edit / Filter / Log / Info / +) are
  // tried FIRST. Column headers and pagination are excluded — they're
  // handled by their own passes and would otherwise eat all the slots.
  await runActionButtonPass(page, basePath, log, clickedLabels, pushState);

  // ── 3.5. TABLE COLUMN HEADERS (click to sort) ─────────────────────
  await forEachVisible(
    page,
    [
      'thead th[role="button"]',
      'thead th[aria-sort]',
      'thead th[tabindex]:not([tabindex="-1"])',
      'thead [role="button"]',
      '[role="columnheader"][role="button"]',
      '[class*="HeaderCell"][role="button"]',
      '[class*="ColumnHeader"][role="button"]',
      '[data-testid*="column-header" i]',
    ].join(", "),
    MAX.columns, log, "Kolon header", true,
    async (loc, label, i) => {
      if (!label || label.length < 2 || label.length > 40) return false;
      if (clickedLabels.has(`col:${label}`)) return false;
      clickedLabels.add(`col:${label}`);

      try {
        await loc.click({ timeout: ACTION_TIMEOUT });
      } catch {
        try { await loc.click({ timeout: ACTION_TIMEOUT, force: true }); }
        catch { await loc.evaluate((el: HTMLElement) => el.click()).catch(() => {}); }
      }
      await page.waitForTimeout(RENDER_WAIT);
      await pushState(
        `Sıralama: "${label}"`,
        `kolon header tıklandı: ${label}`,
        `${basePath}_sort_${i}`
      );
      log(`  ✓ Kolon sıralama yakalandı: ${label}`);
      return true;
    }
  );

  // ── 3.6. ROW ACTION MENUS (kebab/3-dots) ──────────────────────────
  await forEachVisible(
    page,
    [
      'tbody button[aria-label*="action" i]',
      'tbody button[aria-label*="more" i]',
      'tbody button[aria-label*="işlem" i]',
      'tbody [aria-haspopup="menu"]',
      'tbody [aria-haspopup="true"]',
      'tbody [class*="kebab" i]',
      'tbody [class*="MoreVert"]',
      'tbody [class*="MoreOptions"]',
      'tbody [class*="ellipsis" i]',
      '[role="row"] button[aria-haspopup]',
      '[role="row"] [class*="MoreVert"]',
      'tr button:has(svg):not([disabled])',
    ].join(", "),
    MAX.rowActions, log, "Satır aksiyon", true,
    async (loc, _label, i) => {
      try {
        await loc.click({ timeout: ACTION_TIMEOUT });
      } catch {
        try { await loc.click({ timeout: ACTION_TIMEOUT, force: true }); }
        catch { await loc.evaluate((el: HTMLElement) => el.click()).catch(() => {}); }
      }
      await page.waitForTimeout(RENDER_WAIT);
      await pushState(
        `Satır aksiyon menüsü`,
        `tablo satırında aksiyon butonu tıklandı`,
        `${basePath}_rowaction_${i}`
      );
      log(`  ✓ Satır aksiyon menüsü yakalandı`);

      // If clicking this row action itself opened a modal, capture it.
      if (await modalIsOpen(page)) {
        await pushState(
          `Modal: satır işlemi`,
          `satır aksiyon ikonu modal açtı`,
          `${basePath}_rowmodal_${i}`
        );
        log(`  ✓ Satır işlemi modalı yakalandı`);
        await closeModal(page);
      }

      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  );

  // ── 3.6b. ROW EDIT/DETAIL ICONS — drill into edit & detail modals ──
  // This app puts inline icon buttons in each row's ACTIONS column
  // instead of a kebab menu. Probe edit/detail-labelled icons on the
  // first row so the edit & detail modals get documented.
  for (const editSel of [
    'tbody tr:first-child [aria-label*="edit" i]',
    'tbody tr:first-child [aria-label*="düzenle" i]',
    'tbody tr:first-child [aria-label*="detay" i]',
    'tbody tr:first-child [aria-label*="detail" i]',
    'tbody tr:first-child [title*="edit" i]',
    'tbody tr:first-child [title*="düzenle" i]',
    'tbody tr:first-child [title*="detay" i]',
    'tbody tr:first-child a[href*="edit" i]',
    'tbody tr:first-child [class*="edit" i]',
  ]) {
    try {
      const icon = page.locator(editSel).first();
      if (!(await icon.isVisible({ timeout: 400 }))) continue;
      const lbl =
        (await icon.getAttribute("aria-label").catch(() => null)) ||
        (await icon.getAttribute("title").catch(() => null)) ||
        "Düzenle";
      if (isDestructive(lbl)) continue;
      log(`Satır edit ikonu deneniyor: ${lbl} (${editSel})`);
      await icon.click({ timeout: ACTION_TIMEOUT }).catch(async () => {
        await icon.click({ timeout: ACTION_TIMEOUT, force: true });
      });
      await page.waitForTimeout(RENDER_WAIT + 400);
      if (await modalIsOpen(page)) {
        await pushState(
          `Modal: "${lbl}" (satır düzenleme/detay)`,
          `satır ${lbl} ikonu tıklandı`,
          `${basePath}_rowedit`
        );
        log(`  ✓ Satır düzenleme/detay modalı yakalandı: ${lbl}`);
        await closeModal(page);
        break;
      }
    } catch { /* try next */ }
  }

  // ── 4. DATE PICKERS ──────────────────────────────────────────────
  await forEachVisible(
    page,
    [
      'input[type="date"]', 'input[type="datetime-local"]',
      'input[type="month"]', 'input[type="week"]',
      '[class*="DatePicker"]', '[class*="date-picker"]', '[class*="datepicker"]',
      '[data-testid*="date" i]',
      '[aria-label*="tarih" i]', '[aria-label*="date" i]',
    ].join(", "),
    MAX.dates, log, "Tarih seçici", true,
    async (loc, label, i) => {
      await loc.click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(800);
      await pushState(
        `Tarih seçici açık: "${label || "tarih"}"`,
        `tarih input tıklandı: ${label || "(etiketsiz)"}`,
        `${basePath}_date_${i}`
      );
      log(`  ✓ Tarih seçici yakalandı: ${label || "(etiketsiz)"}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  );

  // ── 5. CHECKBOXES ────────────────────────────────────────────────
  await forEachVisible(
    page,
    'input[type="checkbox"]:not([disabled]):not([readonly]), [role="checkbox"]:not([aria-disabled="true"]), [class*="Checkbox"]:not([disabled])',
    MAX.checkboxes, log, "Checkbox", true,
    async (loc, label, i) => {
      const wasChecked = await loc.isChecked().catch(() => false);
      await loc.click({ timeout: ACTION_TIMEOUT, force: true });
      await page.waitForTimeout(400);
      await pushState(
        `Checkbox ${wasChecked ? "kaldırıldı" : "işaretlendi"}: "${label || "(etiketsiz)"}"`,
        `checkbox toggle: ${label || "(etiketsiz)"}`,
        `${basePath}_cb_${i}`
      );
      log(`  ✓ Checkbox yakalandı: ${label || "(etiketsiz)"}`);
      // Revert
      await loc.click({ timeout: ACTION_TIMEOUT, force: true }).catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  );

  // ── 6. TOGGLE SWITCHES ───────────────────────────────────────────
  await forEachVisible(
    page,
    [
      '[role="switch"]:not([aria-disabled="true"])',
      '.ant-switch:not(.ant-switch-disabled)',
      '.MuiSwitch-root input[type="checkbox"]',
      '[class*="toggle-switch" i]:not(button)',
      '[class*="Toggle"][role="button"]',
      '[class*="Switch"][role="button"]',
    ].join(", "),
    MAX.toggles, log, "Toggle", true,
    async (loc, label, i) => {
      await loc.click({ timeout: ACTION_TIMEOUT, force: true });
      await page.waitForTimeout(500);
      await pushState(
        `Toggle değişti: "${label || "switch"}"`,
        `toggle: ${label || "(etiketsiz)"}`,
        `${basePath}_toggle_${i}`
      );
      log(`  ✓ Toggle yakalandı: ${label || "(etiketsiz)"}`);
      await loc.click({ timeout: ACTION_TIMEOUT, force: true }).catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  );

  // ── 7. TEXT INPUT FOCUS ──────────────────────────────────────────
  await forEachVisible(
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
    MAX.inputs, log, "Text input", true,
    async (loc, label, i) => {
      await loc.focus({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(500);
      await pushState(
        `Input focus: "${label || "metin alanı"}"`,
        `input focus: ${label || "(etiketsiz)"}`,
        `${basePath}_input_${i}`
      );
      log(`  ✓ Input focus yakalandı: ${label || "(etiketsiz)"}`);
      await loc.evaluate((el: HTMLElement) => el.blur()).catch(() => {});
      return true;
    }
  );

  // ── 8. HELP / INFO ICONS (hover) ─────────────────────────────────
  await forEachVisible(
    page,
    [
      '[aria-label*="info" i]', '[aria-label*="help" i]',
      '[aria-label*="yardım" i]', '[aria-label*="bilgi" i]',
      '[class*="info-icon" i]', '[class*="InfoIcon"]',
      '[class*="help-icon" i]', '[class*="HelpIcon"]',
      '[class*="question" i]', '[data-tooltip]',
      '[title]:not(html):not(body)',
      'th[title]', 'td[title]', '[aria-describedby]',
    ].join(", "),
    MAX.hovers, log, "Yardım icon", false,
    async (_loc, _label, i) => {
      await _loc.hover({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(900);
      await pushState(
        `Tooltip ${i + 1}`,
        `hover on info icon`,
        `${basePath}_hover_${i}`
      );
      log(`  ✓ Tooltip yakalandı`);
      await page.mouse.move(0, 0).catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  );

  // ── 9. ACCORDIONS ────────────────────────────────────────────────
  await forEachVisible(
    page,
    [
      'details > summary',
      '[aria-expanded="false"][role="button"]',
      '[aria-expanded="false"][class*="accordion" i]',
      '[class*="accordion-header" i]', '[class*="AccordionHeader"]',
      '[class*="Collapse"][role="button"]',
      '[class*="collapsible" i]',
    ].join(", "),
    MAX.accordions, log, "Accordion", true,
    async (loc, label, i) => {
      await loc.click({ timeout: ACTION_TIMEOUT, force: true });
      await page.waitForTimeout(500);
      await pushState(
        `Accordion açık: "${label || "bölüm"}"`,
        `accordion: ${label || "(etiketsiz)"}`,
        `${basePath}_acc_${i}`
      );
      log(`  ✓ Accordion yakalandı: ${label || "(etiketsiz)"}`);
      return true;
    }
  );

  // ── 10. GENERIC BUTTON FALLBACK ──────────────────────────────────
  if (states.length < 3) {
    log("Az state yakalandı, generic buton taraması yapılıyor…");
    await forEachVisible(
      page,
      'button:not([disabled]), [role="button"]:not([aria-disabled="true"])',
      MAX.fallback, log, "Buton (fallback)", true,
      async (loc, label, i) => {
        if (!label || label.length < 2 || label.length > 35) return false;
        if (clickedLabels.has(label)) return false;
        clickedLabels.add(label);

        const beforeUrl = page.url();
        await loc.click({ timeout: ACTION_TIMEOUT });
        await page.waitForTimeout(800);

        if (page.url() !== beforeUrl) {
          await page.goBack({ timeout: ACTION_TIMEOUT }).catch(() => {});
          await page.waitForTimeout(500);
          return false;
        }

        await pushState(
          `Buton sonrası: "${label}"`,
          `generic buton: ${label}`,
          `${basePath}_btn_${i}`
        );
        log(`  ✓ Buton state yakalandı: ${label}`);

        if (await modalIsOpen(page)) await closeModal(page);
        return true;
      }
    );
  }

  log(`Toplam ${states.length} ek state yakalandı.`);
  return states;
}
