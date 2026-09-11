import { Router, type Request, type Response } from "express";

import { screenStore } from "../store/screenStore";
import { documentStore } from "../store/documentStore";
import { referenceStore } from "../store/referenceStore";
import { docHasQualityWarning } from "../../quality/docFingerprint";

const router = Router();

export type FreshnessStatus =
  | "fresh"          // doküman var ve güncel görünüyor
  | "screen-changed" // ekran, doküman üretildikten SONRA yeniden keşfedildi
  | "sources-changed"// kaynaklar (Confluence/Jira) dokümandan sonra senkronlandı
  | "warning"        // doküman kalite-uyarısı taşıyor (eksik/kesik/…)
  | "no-doc";        // bu ekran için henüz doküman yok

interface FreshnessRow {
  path: string;
  title: string;
  screenshotPath: string;
  status: FreshnessStatus;
  docId?: string;
  docStatus?: string;
  docUpdatedAt?: string;
  discoveredAt?: string;
}

function maxDate(dates: (string | undefined)[]): string | null {
  const ts = dates.filter(Boolean).map((d) => new Date(d as string).getTime()).filter((n) => !Number.isNaN(n));
  if (ts.length === 0) return null;
  return new Date(Math.max(...ts)).toISOString();
}

/**
 * GET /api/freshness — ekran-başı tazelik özeti. UCUZ, deterministik (Claude
 * çağrısı YOK): dokümanın var olup olmadığı + doküman-üretim tarihi vs ekran
 * son-keşif / kaynak son-senkron tarihini karşılaştırır. "Olası değişiklik"
 * sinyali verir; kesin karar üretimdeki parmak izi skip'i tarafından verilir
 * (değişmemişse zaten 0 token atlanır).
 */
router.get("/", (_req: Request, res: Response) => {
  const screens = screenStore.getAll();
  const sourcesUpdatedAt = maxDate([
    ...referenceStore.getAllConfluence().map((c) => c.syncedAt),
    ...referenceStore.getAllJira().map((j) => j.syncedAt),
  ]);

  const rows: FreshnessRow[] = screens.map((s) => {
    const doc = documentStore.getLatestByScreenPath(s.path);
    let status: FreshnessStatus;
    if (!doc) {
      status = "no-doc";
    } else if (docHasQualityWarning(doc.userManualContent)) {
      status = "warning";
    } else if (s.discoveredAt && new Date(s.discoveredAt) > new Date(doc.createdAt)) {
      status = "screen-changed";
    } else if (sourcesUpdatedAt && new Date(sourcesUpdatedAt) > new Date(doc.createdAt)) {
      status = "sources-changed";
    } else {
      status = "fresh";
    }
    return {
      path: s.path,
      title: s.title || s.path,
      screenshotPath: s.screenshotPath,
      status,
      ...(doc ? { docId: doc.id, docStatus: doc.status, docUpdatedAt: doc.updatedAt } : {}),
      ...(s.discoveredAt ? { discoveredAt: s.discoveredAt } : {}),
    };
  });

  const summary = {
    total: rows.length,
    fresh: rows.filter((r) => r.status === "fresh").length,
    stale: rows.filter((r) => r.status === "screen-changed" || r.status === "sources-changed").length,
    warning: rows.filter((r) => r.status === "warning").length,
    noDoc: rows.filter((r) => r.status === "no-doc").length,
  };

  res.json({ sourcesUpdatedAt, summary, rows });
});

export default router;
