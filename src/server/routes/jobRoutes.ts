import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";

import { jobStore } from "../store/jobStore";
import { documentStore } from "../store/documentStore";
import { eventBus } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";
import { runDocumentationJob } from "../jobs/documentationJob";

/**
 * Failed/cancelled/completed bir job için "eksik ekranlar" set'ini hesaplar:
 * orijinal seçilen screenPaths - üretilmiş documents.screenPath.
 * Eski job'larda screenPaths kayıtlı değilse boş döner (geriye dönük uyum).
 */
function missingScreensForJob(jobId: string): string[] {
  const job = jobStore.getById(jobId);
  if (!job || !job.screenPaths || job.screenPaths.length === 0) return [];
  const produced = new Set(documentStore.getByJobId(jobId).map((d) => d.screenPath));
  return job.screenPaths.filter((p) => !produced.has(p));
}

const router = Router();

// POST /api/jobs/start
router.post("/start", (req: Request, res: Response) => {
  const screenPaths: string[] = req.body?.screenPaths ?? [];

  if (screenPaths.length === 0) {
    res
      .status(400)
      .json({ error: "screenPaths must be a non-empty array" });
    return;
  }

  const jobId = uuid();

  jobStore.create({
    id: jobId,
    type: "documentation",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: {
      current: 0,
      total: screenPaths.length,
      message: "Bekliyor...",
    },
    // Eksik retry için seçilen ekran path'lerini sakla.
    screenPaths,
  });

  runDocumentationJob(jobId, screenPaths).catch((err) => {
    console.error("Documentation job failed:", err.message);
  });

  res.json({ jobId });
});

// GET /api/jobs — her satırda eksik ekran sayısı dahil.
router.get("/", (_req: Request, res: Response) => {
  const enriched = jobStore.getAll().map((j) => ({
    ...j,
    missingScreenCount: missingScreensForJob(j.id).length,
  }));
  res.json(enriched);
});

// GET /api/jobs/:jobId — job + eksik ekran sayısı (varsa).
router.get("/:jobId", (req: Request, res: Response) => {
  const job = jobStore.getById(req.params.jobId as string);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const missing = missingScreensForJob(job.id);
  res.json({ ...job, missingScreenCount: missing.length });
});

// POST /api/jobs/:jobId/retry-missing — yalnız üretilmemiş ekranlar için
// yeni bir documentation job başlat. Failed/cancelled/completed her
// statüde çalışabilir (eksik varsa).
router.post("/:jobId/retry-missing", (req: Request, res: Response) => {
  const jobId = req.params["jobId"] as string;
  const job = jobStore.getById(jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (!job.screenPaths || job.screenPaths.length === 0) {
    res.status(400).json({
      error: "Bu job'ta orijinal ekran listesi yok (eski sürümden kalma). Yeni bir job başlatın.",
    });
    return;
  }
  const missing = missingScreensForJob(jobId);
  if (missing.length === 0) {
    res.status(400).json({ error: "Eksik ekran yok — tüm ekranlar zaten üretilmiş." });
    return;
  }

  const newJobId = uuid();
  jobStore.create({
    id: newJobId,
    type: "documentation",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: { current: 0, total: missing.length, message: `Bekliyor (eksik: ${missing.length})...` },
    screenPaths: missing,
  });
  runDocumentationJob(newJobId, missing).catch((err) => {
    console.error("Retry-missing job failed:", (err as Error).message);
  });

  res.json({ jobId: newJobId, count: missing.length });
});

// POST /api/jobs/:jobId/cancel — request cancellation
router.post("/:jobId/cancel", (req: Request, res: Response) => {
  const jobId = req.params["jobId"] as string;
  const job = jobStore.getById(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  jobCancellation.cancel(jobId);
  res.json({ ok: true });
});

// POST /api/jobs/:jobId/pause — runner will block at the next checkpoint
router.post("/:jobId/pause", (req: Request, res: Response) => {
  const jobId = req.params["jobId"] as string;
  const job = jobStore.getById(jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "running") {
    res.status(400).json({ error: `Sadece çalışan job duraklatılabilir (mevcut: ${job.status})` });
    return;
  }
  jobCancellation.pause(jobId);
  jobStore.update(jobId, {
    status: "paused" as never,
    progress: { ...job.progress, message: "⏸ Kullanıcı tarafından duraklatıldı" },
  });
  eventBus.emit(`job:${jobId}`, { type: "progress", message: "⏸ Duraklatıldı" });
  res.json({ ok: true });
});

// POST /api/jobs/:jobId/resume — clear pause flag
router.post("/:jobId/resume", (req: Request, res: Response) => {
  const jobId = req.params["jobId"] as string;
  const job = jobStore.getById(jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  jobCancellation.resume(jobId);
  jobStore.update(jobId, {
    status: "running",
    progress: { ...job.progress, message: "▶ Devam ediliyor" },
  });
  eventBus.emit(`job:${jobId}`, { type: "progress", message: "▶ Devam ediliyor" });
  res.json({ ok: true });
});

// DELETE /api/jobs/:jobId — remove a single job from history
router.delete("/:jobId", (req: Request, res: Response) => {
  const ok = jobStore.delete(req.params["jobId"] as string);
  if (!ok) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({ ok: true });
});

// POST /api/jobs/cleanup — delete jobs by filter
// body: { status?: ["completed","failed"], olderThanHours?: number }
router.post("/cleanup", (req: Request, res: Response) => {
  const { status, olderThanHours } = req.body as {
    status?: string[];
    olderThanHours?: number;
  };
  const statusSet = new Set(status ?? ["completed", "failed"]);
  const cutoff = olderThanHours !== undefined ? Date.now() - olderThanHours * 3600_000 : Infinity;

  const removed = jobStore.deleteWhere(
    (j) =>
      statusSet.has(j.status) &&
      (olderThanHours === undefined || new Date(j.createdAt).getTime() < cutoff)
  );
  res.json({ removed });
});

// GET /api/jobs/:jobId/stream — SSE
router.get("/:jobId/stream", (req: Request, res: Response) => {
  const jobId = req.params["jobId"] as string;

  if (!jobId) {
    res.status(400).json({ error: "jobId required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const listener = (event: unknown) => {
    send(event);
  };

  eventBus.on(`job:${jobId}`, listener);

  const job = jobStore.getById(jobId);
  if (job) {
    send({
      type: "progress",
      message: job.progress.message,
      current: job.progress.current,
      total: job.progress.total,
    });

    if (
      job.status === "completed" ||
      job.status === "failed"
    ) {
      send({
        type: job.status === "completed" ? "complete" : "error",
        message: job.progress.message,
      });
    }
  }

  req.on("close", () => {
    eventBus.off(`job:${jobId}`, listener);
  });
});

export default router;
