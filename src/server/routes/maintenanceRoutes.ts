import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

import { screenStore } from "../store/screenStore";
import { documentStore } from "../store/documentStore";

const router = Router();

/**
 * Delete screenshots that are no longer referenced by any screen, state
 * or document. Returns counts + bytes freed.
 *
 * Referenced if any of:
 *   - screenStore.screenshotPath
 *   - screenStore.states[*].screenshotPath
 *   - documentStore.screenshotPath
 */
router.post("/cleanup-screenshots", (_req: Request, res: Response) => {
  const referenced = new Set<string>();

  for (const s of screenStore.getAll()) {
    if (s.screenshotPath) referenced.add(path.basename(s.screenshotPath));
    for (const st of s.states ?? []) {
      if (st.screenshotPath) referenced.add(path.basename(st.screenshotPath));
    }
  }
  for (const d of documentStore.getAll()) {
    if (d.screenshotPath) referenced.add(path.basename(d.screenshotPath));
  }

  const shotDir = path.join(process.cwd(), "data", "screenshots");
  let removed = 0;
  let bytesFreed = 0;

  if (fs.existsSync(shotDir)) {
    for (const file of fs.readdirSync(shotDir)) {
      if (!file.endsWith(".png")) continue;
      if (referenced.has(file)) continue;
      const fp = path.join(shotDir, file);
      try {
        const st = fs.statSync(fp);
        bytesFreed += st.size;
        fs.unlinkSync(fp);
        removed++;
      } catch { /* ignore */ }
    }
  }

  res.json({ removed, bytesFreed, kept: referenced.size });
});

/**
 * Show how much disk we'd free without actually deleting.
 */
router.get("/disk-usage", (_req: Request, res: Response) => {
  const dirs = [
    "data/screenshots",
    "data/references",
    "data/logs",
    "data/db",
    "data/exports",
  ];

  const out: Record<string, { files: number; bytes: number }> = {};
  for (const rel of dirs) {
    const dir = path.join(process.cwd(), rel);
    let files = 0;
    let bytes = 0;
    if (fs.existsSync(dir)) {
      const walk = (d: string) => {
        for (const f of fs.readdirSync(d)) {
          const fp = path.join(d, f);
          const st = fs.statSync(fp);
          if (st.isDirectory()) walk(fp);
          else {
            files++;
            bytes += st.size;
          }
        }
      };
      walk(dir);
    }
    out[rel] = { files, bytes };
  }

  res.json(out);
});

export default router;
