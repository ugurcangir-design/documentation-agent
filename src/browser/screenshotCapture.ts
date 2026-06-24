import type { Page, Locator } from "playwright";
import path from "path";
import fs from "fs";

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

export async function captureScreenshot(
  page: Page,
  screenPath: string,
  opts: CaptureOptions = {}
): Promise<ScreenshotResult> {
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
