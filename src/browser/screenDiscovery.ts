import { Page } from "playwright";

import { env } from "../config/env";
import { DiscoveredScreen } from "../types/screen";
import { captureScreenshot } from "./screenshotCapture";

const NAV_SELECTORS = [
  "nav a",
  "header a",
  ".sidebar a",
  ".side-nav a",
  ".menu a",
  ".navigation a",
  "[role='navigation'] a",
  "[role='menubar'] a",
  ".nav-item a",
  ".menu-item a",
  ".navbar a",
];

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
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 20000,
    });

    await page.waitForTimeout(800);

    const title = await page.title();
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
        els
          .map((el) => (el as HTMLAnchorElement).href)
          .filter(Boolean)
      );

      hrefs.push(...found);
    } catch {
      // selector not found on this page — skip
    }
  }

  const unique = [...new Set(hrefs)];

  return unique.filter((link) => {
    try {
      const linkUrl = new URL(link);
      const base = new URL(baseUrl);

      return (
        linkUrl.origin === base.origin &&
        !link.includes("#") &&
        !link.match(/\.(pdf|xlsx|csv|zip|docx|png|jpg|svg)$/i)
      );
    } catch {
      return false;
    }
  });
}
