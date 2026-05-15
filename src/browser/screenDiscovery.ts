import { Page } from "playwright";

import { env } from "../config/env";
import { DiscoveredScreen } from "../types/screen";
import { captureScreenshot } from "./screenshotCapture";

const NAV_SELECTORS = [
  "nav a",
  "header a",
  "aside a",
  ".sidebar a",
  ".side-nav a",
  ".menu a",
  ".navigation a",
  "[role='navigation'] a",
  "[role='menubar'] a",
  "[role='menuitem'] a",
  "[role='tab'] a",
  ".nav-item a",
  ".menu-item a",
  ".navbar a",
  ".MuiDrawer-root a",
  ".ant-menu a",
  "[data-testid*='nav'] a",
  "[data-testid*='menu'] a",
  "[class*='Sidebar'] a",
  "[class*='Nav'] a",
  "[class*='Menu'] a",
];

// Fallback: any same-origin <a> when nav selectors return nothing
const FALLBACK_SELECTOR = "a[href]";

export async function discoverScreens(
  page: Page
): Promise<DiscoveredScreen[]> {
  const baseUrl = env.appBaseUrl;
  const discovered = new Map<string, DiscoveredScreen>();
  const maxDepth = env.maxDiscoveryDepth;

  console.log(`\n  Starting discovery from: ${baseUrl}`);
  console.log(`  Max depth: ${maxDepth}`);

  await discoverAtDepth(
    page,
    baseUrl,
    0,
    discovered,
    baseUrl,
    maxDepth
  );

  const screens = Array.from(discovered.values());
  console.log(`\n  Total screens discovered: ${screens.length}`);

  return screens;
}

async function discoverAtDepth(
  page: Page,
  url: string,
  depth: number,
  discovered: Map<string, DiscoveredScreen>,
  baseUrl: string,
  maxDepth: number,
  parentPath?: string
): Promise<void> {
  if (depth > maxDepth) return;

  let path: string;

  try {
    path = new URL(url).pathname;
  } catch {
    return;
  }

  if (discovered.has(path)) return;

  console.log(`  [depth ${depth}] Visiting: ${url}`);

  try {
    // SPAs often never reach networkidle (polling, websockets).
    // Use domcontentloaded + a render delay, fall back gracefully on timeout.
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    } catch (gotoErr) {
      console.warn(`    page.goto warning: ${(gotoErr as Error).message} — devam ediliyor`);
    }

    // Give the SPA a chance to render
    await page.waitForTimeout(2000);
    try {
      await page.waitForLoadState("load", { timeout: 5000 });
    } catch {
      // ignore — some pages never fire 'load'
    }

    const title = await page.title();
    const finalUrl = page.url();
    console.log(`    Page loaded: title="${title}" url="${finalUrl}"`);

    const { screenshotPath, screenshotBase64 } =
      await captureScreenshot(page, path);

    const screen: DiscoveredScreen = {
      url,
      path,
      title,
      screenshotPath,
      screenshotBase64,
      depth,
      ...(parentPath !== undefined ? { parentPath } : {}),
    };

    discovered.set(path, screen);

    console.log(`    Captured: "${title}" → ${screenshotPath}`);

    if (depth < maxDepth) {
      const links = await extractNavLinks(page, baseUrl);

      console.log(`    Found ${links.length} nav links`);

      for (const link of links) {
        let linkPath: string;

        try {
          linkPath = new URL(link).pathname;
        } catch {
          continue;
        }

        if (!discovered.has(linkPath)) {
          await discoverAtDepth(
            page,
            link,
            depth + 1,
            discovered,
            baseUrl,
            maxDepth,
            path
          );
        }
      }
    }
  } catch (err) {
    console.error(
      `    Failed to visit: ${url} — ${(err as Error).message}`
    );
  }
}

async function extractNavLinks(
  page: Page,
  baseUrl: string
): Promise<string[]> {
  const hrefs: string[] = [];

  for (const selector of NAV_SELECTORS) {
    try {
      const found = await page.$$eval(selector, (els) =>
        els.map((el) => (el as HTMLAnchorElement).href).filter(Boolean)
      );
      hrefs.push(...found);
    } catch {
      // selector not found on this page — skip
    }
  }

  // Fallback: if nav selectors yielded nothing, collect ALL same-origin links
  if (hrefs.length === 0) {
    try {
      const all = await page.$$eval(FALLBACK_SELECTOR, (els) =>
        els.map((el) => (el as HTMLAnchorElement).href).filter(Boolean)
      );
      console.log(`    nav selectors empty — fallback gathered ${all.length} <a> elements`);
      hrefs.push(...all);
    } catch {
      // ignore
    }
  }

  const unique = [...new Set(hrefs)];

  const filtered = unique.filter((link) => {
    try {
      const linkUrl = new URL(link);
      const base = new URL(baseUrl);
      return (
        linkUrl.origin === base.origin &&
        !link.includes("#") &&
        !link.match(/\.(pdf|xlsx|csv|zip|docx|png|jpg|svg|ico)$/i)
      );
    } catch {
      return false;
    }
  });

  return filtered;
}
