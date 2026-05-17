import fs from "fs";
import path from "path";

/**
 * Atomic JSON writer. Writes to `<path>.<pid>.<ts>.tmp` first, then
 * renames over the target. If the process crashes mid-write the
 * temp file stays orphaned but the canonical file is never partial.
 *
 * Use this everywhere we persist to data/db/*.json. The previous
 * code used plain fs.writeFileSync which truncates on open — a
 * crash between truncate and write left the file empty/half-written.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/** Safe JSON read — returns fallback if file is missing OR corrupted. */
export function readJsonSafe<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (err) {
    console.warn(`[atomicJson] ${filePath} corrupt, using fallback:`, (err as Error).message);
    return fallback;
  }
}
