/**
 * Interactive screen explorer — simulates a test user.
 *
 * Uses Playwright Locator API throughout (re-queries DOM on each access),
 * which survives React/Vue/Svelte re-renders. Restricts most interactions
 * to the page's main content area so we don't accidentally click sidebar
 * navigation items.
 */

import type { Page, Locator } from "playwright";
import { captureScreenshot, type CaptureOptions } from "./screenshotCapture";
import { fillTestData, triggerValidation, clickSubmitButton } from "./formFiller";
import { env } from "../config/env";
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
  tabs: 8, dropdowns: 5, modals: 10, dates: 4,
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

/** Global "chrome" — bu ekranın içeriği DEĞİL, sayfa şablonu: sol sidebar,
 *  üst bar (header/topbar/navbar/appbar) ve içindeki profil/hesap/dil/
 *  bildirim kontrolleri. Bunlar yakalanmamalı; aksi halde profil menüsü,
 *  dil seçici gibi ekranla ilgisiz görseller kılavuza giriyor. */
async function isInNavOrSidebar(loc: Locator): Promise<boolean> {
  try {
    return await loc.evaluate((el: Element) => {
      // 1. Kapsayıcı: sidebar veya üst bar içinde mi?
      if (
        el.closest(
          'aside, nav, [role="navigation"], header, [role="banner"], ' +
          '[class*="sidebar" i], [class*="side-nav" i], ' +
          '[class*="topbar" i], [class*="top-bar" i], [class*="navbar" i], ' +
          '[class*="appbar" i], [class*="app-bar" i], [class*="headerbar" i]'
        )
      ) {
        return true;
      }
      // 2. Profil / hesap / dil / bildirim kontrolü mü? (üst barda olmasa bile)
      if (
        el.closest(
          '[class*="profile" i], [class*="account" i], [class*="user-menu" i], ' +
          '[class*="usermenu" i], [class*="avatar" i], [class*="lang" i], ' +
          '[class*="locale" i], [class*="i18n" i], [class*="notification" i], ' +
          '[aria-label*="profile" i], [aria-label*="profil" i], ' +
          '[aria-label*="account" i], [aria-label*="hesap" i], ' +
          '[aria-label*="language" i], [aria-label*="dil" i], ' +
          '[aria-label*="notification" i], [aria-label*="bildirim" i], ' +
          '[aria-label*="logout" i], [aria-label*="çıkış" i], [aria-label*="cikis" i]'
        )
      ) {
        return true;
      }
      // 3. Etiket metni dil/profil/çıkış mı? (örn. "Türkçe", "EN", "Profilim")
      const txt = (el.textContent || "").trim().toLowerCase().slice(0, 30);
      if (/^(profil|profilim|hesab|hesabım|çıkış|cikis|logout|sign out|oturumu kapat)/.test(txt)) {
        return true;
      }
      return false;
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

/** Açık modal/dialog'un Locator'ını döndürür (clip'li screenshot için).
 *  Yoksa null. */
async function openModalLocator(page: Page): Promise<Locator | null> {
  for (const sel of MODAL_SELECTORS) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 200 })) return loc;
    } catch { /* noop */ }
  }
  return null;
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
  pushState: (label: string, triggeredBy: string, filename: string, capture?: CaptureOptions) => Promise<void>
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

    const modalLoc = await openModalLocator(page);
    const isModal = modalLoc !== null;
    const kind = isModal ? "Modal" : "Panel/etki";
    // Modal'ı arka plan karartması olmadan kırparak yakala; panel için viewport.
    const clipOpt: CaptureOptions = isModal && modalLoc ? { clip: modalLoc } : {};
    await pushState(`${kind}: "${cand.label}"`, `buton tıklandı: ${cand.label}`, `${basePath}_btn_${cand.index}`, clipOpt);
    log(`  ✓ ${kind} yakalandı: ${cand.label}${cand.priority === 2 ? " (öncelikli)" : ""}`);
    captured++;

    // Sub-explore: modal/panel açıkken alanları güvenli test verisiyle
    // doldur ve "dolu form" state'ini yakala → kılavuz adım-adım veri
    // girişini gerçek değerlerle anlatabilir (asla submit edilmez).
    if (env.fillTestData) {
      try {
        const scope = isModal && modalLoc ? modalLoc : page;
        const { filledCount } = await fillTestData(page, scope, log);
        if (filledCount > 0) {
          await page.waitForTimeout(400);
          await pushState(
            `${kind} (dolu): "${cand.label}"`,
            `${kind} test verisiyle dolduruldu (${filledCount} alan)`,
            `${basePath}_btn_${cand.index}_filled`,
            clipOpt
          );
          log(`  ↳ ${kind} dolu form state'i yakalandı (${filledCount} alan)`);

          // Katman A — doğrulama uyarısı (mutasyonsuz): bir alanı geçersiz
          // yap, blur ile inline hata mesajını yakala, sonra yeniden doldur.
          try {
            if (await triggerValidation(page, scope, log)) {
              await pushState(
                `${kind} doğrulama uyarısı: "${cand.label}"`,
                `zorunlu/geçersiz alan blur — istemci doğrulaması`,
                `${basePath}_btn_${cand.index}_invalid`,
                clipOpt
              );
              await fillTestData(page, scope, log); // geçerli değere dön
              await page.waitForTimeout(300);
            }
          } catch { /* doğrulama tetiklenemedi */ }

          // Katman C — GERÇEK yazma submit (yalnız ALLOW_FORM_SUBMIT açıkken;
          // hedef uygulamada gerçek kayıt oluşturur). Kayıt-sonrası ekranı
          // (başarı toast'ı / kapanan modal / liste) yakalar.
          if (env.allowFormSubmit) {
            try {
              const res = await clickSubmitButton(page, scope, "write", log);
              if (res.clicked) {
                await page.waitForTimeout(1500);
                const stillModal = await modalIsOpen(page);
                await pushState(
                  `Kayıt sonrası: "${cand.label}"`,
                  `form gönderildi (${res.label}) — GERÇEK submit`,
                  `${basePath}_btn_${cand.index}_saved`,
                  stillModal ? clipOpt : { fullPage: true }
                );
                log(`  ✓ Kayıt-sonrası ekran yakalandı (${res.label})`);
              }
            } catch { /* submit başarısız */ }
          }
        }
      } catch { /* doldurma başarısızsa boş form state'i yeterli */ }
    } else {
      // Doldurma kapalıysa en azından bir alanı focus'la (eski davranış).
      try {
        const subInputs = page.locator(
          'input[type="text"]:not([disabled]):not([readonly]):visible, ' +
          'input[type="search"]:visible, [role="combobox"]:visible'
        );
        if ((await subInputs.count()) > 0) {
          await subInputs.first().focus({ timeout: 1500 }).catch(() => {});
          await page.waitForTimeout(500);
          await pushState(`${kind} içi alan: "${cand.label}"`, `${kind} açıkken alt alan focus`, `${basePath}_btn_${cand.index}_inner`, clipOpt);
        }
      } catch { /* noop */ }
    }

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

  const pushState = async (
    label: string,
    triggeredBy: string,
    filename: string,
    capture?: CaptureOptions
  ) => {
    const shot = await captureScreenshot(page, filename, capture);
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
      const editModal = await openModalLocator(page);
      if (editModal) {
        const clipOpt: CaptureOptions = { clip: editModal };
        await pushState(
          `Modal: "${lbl}" (satır düzenleme/detay)`,
          `satır ${lbl} ikonu tıklandı`,
          `${basePath}_rowedit`,
          clipOpt
        );
        log(`  ✓ Satır düzenleme/detay modalı yakalandı: ${lbl}`);
        // Düzenleme modalı genelde mevcut kayıt verisiyle dolu gelir; boş
        // alan varsa test verisiyle doldur ve dolu hâli de yakala.
        if (env.fillTestData) {
          try {
            const { filledCount } = await fillTestData(page, editModal, log);
            if (filledCount > 0) {
              await page.waitForTimeout(400);
              await pushState(
                `Modal (dolu): "${lbl}" (satır düzenleme/detay)`,
                `düzenleme modalı test verisiyle dolduruldu (${filledCount} alan)`,
                `${basePath}_rowedit_filled`,
                clipOpt
              );
            }
          } catch { /* noop */ }
        }
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

  // ── 11. ANA EKRAN FORMU — ekranın kendisi bir form ise (oluştur/düzenle
  // sayfası) ana içerik alanını test verisiyle doldur ve dolu hâli yakala.
  // En sona alındı: önceki pass'leri (checkbox revert, hover) bozmaz.
  if (env.fillTestData && !(await modalIsOpen(page))) {
    try {
      const mainScope = page.locator("main, [role=main], form").first();
      const scope = (await mainScope.count().catch(() => 0)) > 0 ? mainScope : page;
      const { filledCount, labels } = await fillTestData(page, scope, log);
      if (filledCount >= 2) {
        await page.waitForTimeout(400);
        await pushState(
          `Form dolu (ana ekran)`,
          `ana ekran formu test verisiyle dolduruldu: ${labels.slice(0, 4).join(", ")}`,
          `${basePath}_form_filled`,
          { fullPage: true }
        );
        log(`  ✓ Ana ekran dolu form state'i yakalandı (${filledCount} alan)`);

        // Katman B — okuma submit'i (Ara/Filtrele/Listele): mutasyonsuz,
        // her zaman güvenli. Filtre/arama sonucu ekranını yakala.
        try {
          const r = await clickSubmitButton(page, scope, "read", log);
          if (r.clicked) {
            await page.waitForTimeout(1200);
            await pushState(
              `Filtre/arama sonucu`,
              `okuma submit tıklandı (${r.label}) — sonuç listesi`,
              `${basePath}_form_results`,
              { fullPage: true }
            );
            log(`  ✓ Filtre/arama sonuç ekranı yakalandı (${r.label})`);
          }
        } catch { /* okuma submit yok */ }

        // Katman A — doğrulama uyarısı (mutasyonsuz)
        try {
          if (await triggerValidation(page, scope, log)) {
            await pushState(
              `Form doğrulama uyarısı (ana ekran)`,
              `zorunlu/geçersiz alan blur — istemci doğrulaması`,
              `${basePath}_form_invalid`,
              { fullPage: true }
            );
            await fillTestData(page, scope, log);
          }
        } catch { /* noop */ }

        // Katman C — GERÇEK yazma submit (yalnız ALLOW_FORM_SUBMIT açıkken)
        if (env.allowFormSubmit) {
          try {
            const w = await clickSubmitButton(page, scope, "write", log);
            if (w.clicked) {
              await page.waitForTimeout(1500);
              await pushState(
                `Kayıt sonrası (ana ekran)`,
                `form gönderildi (${w.label}) — GERÇEK submit`,
                `${basePath}_form_saved`,
                { fullPage: true }
              );
              log(`  ✓ Kayıt-sonrası ekran yakalandı (${w.label})`);
            }
          } catch { /* submit başarısız */ }
        }
      }
    } catch { /* form yoksa / doldurulamadıysa atla */ }
  }

  log(`Toplam ${states.length} ek state yakalandı.`);
  return states;
}
