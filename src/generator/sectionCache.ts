import fs from "fs";
import path from "path";
import crypto from "crypto";

export function createSectionCacheKey(
  sectionId: string,
  contextJson: string
): string {
  const hash = crypto
    .createHash("sha256")
    .update(sectionId + "::" + contextJson)
    .digest("hex");

  return hash;
}

export function getCachedSection(
  cacheKey: string
): string | null {
  const cacheDir = path.join(
    process.cwd(),
    "data",
    "cache",
    "sections"
  );

  const cachePath = path.join(cacheDir, `${cacheKey}.md`);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  return fs.readFileSync(cachePath, "utf-8");
}

export function saveCachedSection(
  cacheKey: string,
  content: string
): void {
  const cacheDir = path.join(
    process.cwd(),
    "data",
    "cache",
    "sections"
  );

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const cachePath = path.join(cacheDir, `${cacheKey}.md`);

  fs.writeFileSync(cachePath, content);
}