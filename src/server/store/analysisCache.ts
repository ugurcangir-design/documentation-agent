import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { ScreenAnalysis } from "../../types/screen";

const CACHE_PATH = path.join(process.cwd(), "data", "db", "analysisCache.json");

interface CacheEntry {
  hash: string;
  analysis: ScreenAnalysis;
  cachedAt: string;
}

function load(): Record<string, CacheEntry> {
  if (!fs.existsSync(CACHE_PATH)) return {};
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as Record<string, CacheEntry>;
}

function save(data: Record<string, CacheEntry>): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

export function hashScreenshot(base64: string): string {
  return crypto.createHash("sha256").update(base64).digest("hex").slice(0, 16);
}

export const analysisCache = {
  get(hash: string): ScreenAnalysis | null {
    const cache = load();
    return cache[hash]?.analysis ?? null;
  },
  set(hash: string, analysis: ScreenAnalysis): void {
    const cache = load();
    cache[hash] = { hash, analysis, cachedAt: new Date().toISOString() };
    save(cache);
  },
  clear(): void {
    save({});
  },
};
