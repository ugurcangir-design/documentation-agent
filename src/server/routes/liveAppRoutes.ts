import { Router, type Request, type Response } from "express";
import { liveAppStatus } from "../../browser/liveAppMcp";

const router = Router();

// GET /api/live-app/status — canlı uygulama (MCP) özelliğinin önkontrol durumu.
// UI "neden çalışmıyor" sorusunu bunun üzerinden cevaplar (npx var mı, backend
// uygun mu, hedef URL tanımlı mı, otomatik giriş bilgisi var mı).
router.get("/status", (_req: Request, res: Response) => {
  res.json({ ok: true, ...liveAppStatus() });
});

export default router;
