import { Page } from "playwright";
import path from "path";
import fs from "fs";

export interface ScreenshotResult {
  screenshotPath: string;
  screenshotBase64: string;
}

export async function captureScreenshot(
  page: Page,
  screenPath: string
): Promise<ScreenshotResult> {
  const outputDir = path.join(
    process.cwd(),
    "data",
    "screenshots"
  );

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeName =
    screenPath
      .replace(/\//g, "_")
      .replace(/^_/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_") || "root";

  const screenshotFile = path.join(outputDir, `${safeName}.png`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const buffer = await page.screenshot({
    fullPage: false,
    type: "png",
  });

  fs.writeFileSync(screenshotFile, buffer);

  return {
    screenshotPath: screenshotFile,
    screenshotBase64: buffer.toString("base64"),
  };
}
