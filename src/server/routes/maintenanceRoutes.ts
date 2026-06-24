import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

import { screenStore } from "../store/screenStore";
import { documentStore } from "../store/documentStore";
import { computeReferencedScreenshots } from "../../quality/screenshotRefs";

const router = Router();

/**
 * Hiçbir doküman/ekran tarafından kullanılmayan ekran görüntülerini siler.
 * "Kullanılan" tanımı için bkz. quality/screenshotRefs — kabaca: bir
 * dokümana gömülü görseller + ekran/doküman küçük-resimleri + henüz
 * dokümante edilmemiş ekranların state'leri korunur. Dokümante edilmiş
 * ekranların kılavuza girmeyen fazla state görüntüleri temizlenir.
 *
 * Yanıt `reason` alanı: 0 silindiğinde kullanıcıya NEDEN açıklanır.
 */
router.post("/cleanup-screenshots", (_req: Request, res: Response) => {
  const referenced = computeReferencedScreenshots(
    screenStore.getAll(),
    documentStore.getAll()
  );

  const shotDir = path.join(process.cwd(), "data", "screenshots");
  let removed = 0;
  let bytesFreed = 0;
  let scanned = 0;

  if (fs.existsSync(shotDir)) {
    for (const file of fs.readdirSync(shotDir)) {
      if (!file.endsWith(".png")) continue;
      scanned++;
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

  // 0 silindiğinde nedeni açıkla — "çalışmıyor" algısını önle.
  let reason: string | undefined;
  if (removed === 0) {
    const hasDocs = documentStore.getAll().length > 0;
    reason = hasDocs
      ? "Silinecek kullanılmayan görüntü yok — taranan tüm görüntüler bir ekran ya da üretilmiş doküman tarafından kullanılıyor."
      : "Henüz doküman üretilmediği için tüm keşif görüntüleri olası kullanım için saklanıyor. Doküman ürettikten sonra kılavuza girmeyen fazla görüntüler burada temizlenebilir.";
  }

  res.json({ removed, bytesFreed, scanned, kept: referenced.size, ...(reason ? { reason } : {}) });
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
