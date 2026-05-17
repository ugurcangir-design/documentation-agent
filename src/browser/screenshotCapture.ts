import { Page } from "playwright";
import path from "path";
import fs from "fs";

export interface ScreenshotResult {
  screenshotPath: string;
  screenshotBase64: string;
}

// Max dimensions for stored/embedded screenshots. Vision tokens scale
// roughly with image area, and Claude can read 1280×800 UI text just as
// well as 1440×900 — so we trade ~20% area for ~20% input-token savings
// without losing readability.
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 800;

export async function captureScreenshot(
  page: Page,
  screenPath: string
): Promise<ScreenshotResult> {
  const outputDir = path.join(process.cwd(), "data", "screenshots");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const safeName =
    screenPath.replace(/\//g, "_").replace(/^_/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "root";
  const screenshotFile = path.join(outputDir, `${safeName}.png`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const rawBuffer = await page.screenshot({ fullPage: false, type: "png" });

  // Resize via sharp (already a dep) to cap input-token cost on vision calls.
  let buffer: Buffer = rawBuffer;
  try {
    const sharp = (await import("sharp")).default;
    buffer = await sharp(rawBuffer)
      .resize(MAX_WIDTH, MAX_HEIGHT, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    // sharp failure → keep original (still works, just costs more tokens)
  }

  fs.writeFileSync(screenshotFile, buffer);

  return {
    screenshotPath: screenshotFile,
    screenshotBase64: buffer.toString("base64"),
  };
}
