import type { Page, Locator } from "playwright";
import path from "path";
import fs from "fs";
import { env } from "../config/env";

export interface ScreenshotResult {
  screenshotPath: string;
  screenshotBase64: string;
}

export interface CaptureOptions {
  /** Tüm kaydırılabilir içeriği yakala (alt-kıvrım altındaki tablo/form
   *  dahil). Yükseklik MAX_FULLPAGE_HEIGHT ile sınırlanır (token kontrolü). */
  fullPage?: boolean;
  /** Yalnız bu öğeyi (genelde açık bir modal) kırparak yakala — arka plan
   *  karartması olmadan temiz modal görüntüsü. fullPage'i geçersiz kılar. */
  clip?: Locator;
}

// Vision tokens scale roughly with image area. 1280×800 keeps UI text
// fully legible to Claude while saving ~20% tokens vs raw 1440×900.
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 800;
// fullPage çok uzun sayfalarda (sonsuz tablo) görüntüyü sınırla — aksi
// halde tek görsel binlerce vision token yer.
const MAX_FULLPAGE_HEIGHT = 2600;

async function resizePng(rawBuffer: Buffer, maxHeight: number): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(rawBuffer)
      .resize(MAX_WIDTH, maxHeight, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    // sharp failure → keep original (still works, just costs more tokens)
    return rawBuffer;
  }
}

/**
 * Hassas veri bulanıklaştırma (REDACT_SENSITIVE=true, varsayılan kapalı) —
 * yakalamadan önce sayfadaki olası kişisel verileri (e-posta, telefon,
 * TCKN, IBAN) içeren öğelere CSS blur uygular. EN-İYİ-ÇABA: regex tabanlı,
 * kusursuz değildir; kurumsal paylaşım öncesi görselleri yine gözden
 * geçirin. Blur DOM'da kalır (sonraki yakalamalar da tutarlı bulanık) —
 * keşif sayfa yenilemelerinde zaten sıfırlanır. İdempotent (işaretli öğe
 * ikinci kez işlenmez); hata durumunda sessizce geçer, yakalama durmaz.
 */
async function redactSensitiveData(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const PATTERNS = [
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,              // e-posta
        /\+?\d[\d\s().-]{9,16}\d/,                                      // telefon
        /\b\d{11}\b/,                                                    // TCKN benzeri 11 hane
        /\bTR\d{2}[\d\s]{20,30}\b/i,                                    // IBAN (TR)
      ];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let visited = 0;
      const targets: HTMLElement[] = [];
      while (walker.nextNode() && visited < 5000) {
        visited++;
        const node = walker.currentNode as Text;
        const text = node.textContent ?? "";
        if (text.length < 7 || text.length > 400) continue;
        if (!PATTERNS.some((p) => p.test(text))) continue;
        const el = node.parentElement;
        if (!el || el.dataset["docagentRedacted"]) continue;
        targets.push(el);
      }
      for (const el of targets) {
        el.dataset["docagentRedacted"] = "1";
        el.style.filter = "blur(6px)";
      }
      return targets.length;
    });
  } catch { /* en-iyi-çaba — redaction başarısızsa normal yakala */ }
}

export async function captureScreenshot(
  page: Page,
  screenPath: string,
  opts: CaptureOptions = {}
): Promise<ScreenshotResult> {
  if (env.redactSensitive) await redactSensitiveData(page);
  const outputDir = path.join(process.cwd(), "data", "screenshots");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const safeName =
    screenPath.replace(/\//g, "_").replace(/^_/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "root";
  const screenshotFile = path.join(outputDir, `${safeName}.png`);

  let rawBuffer: Buffer;
  let maxHeight = MAX_HEIGHT;

  // 1. Modal kırpma — açık modal'ı arka plan karartması olmadan yakala.
  if (opts.clip) {
    try {
      rawBuffer = await opts.clip.screenshot({ type: "png", timeout: 3000 });
      maxHeight = MAX_FULLPAGE_HEIGHT; // modal uzun olabilir, daha geniş tut
    } catch {
      // modal kayboldu/clip başarısız → tam sayfaya düş
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      rawBuffer = await page.screenshot({ fullPage: false, type: "png" });
    }
  } else {
    // 2. Tam sayfa / viewport
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    if (opts.fullPage) {
      rawBuffer = await page.screenshot({ fullPage: true, type: "png" });
      maxHeight = MAX_FULLPAGE_HEIGHT;
    } else {
      rawBuffer = await page.screenshot({ fullPage: false, type: "png" });
    }
  }

  const buffer = await resizePng(rawBuffer, maxHeight);
  fs.writeFileSync(screenshotFile, buffer);

  return {
    screenshotPath: screenshotFile,
    screenshotBase64: buffer.toString("base64"),
  };
}
