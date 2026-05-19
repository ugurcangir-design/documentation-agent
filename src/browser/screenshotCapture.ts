import { Page } from "playwright";
import path from "path";
import fs from "fs";

export interface ScreenshotResult {
  screenshotPath: string;
  screenshotBase64: string;
}

// Vision tokens scale roughly with image area. Reducing to 1100×700 saves
// ~25% tokens vs 1280×800, while still keeping UI text legible to Claude.
const MAX_WIDTH = 1100;
const MAX_HEIGHT = 700;

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
