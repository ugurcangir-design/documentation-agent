import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";

import { jobStore } from "../store/jobStore";
import { eventBus } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";
import { runDocumentationJob } from "../jobs/documentationJob";

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
  });

  runDocumentationJob(jobId, screenPaths).catch((err) => {
    console.error("Documentation job failed:", err.message);
  });

  res.json({ jobId });
});

// GET /api/jobs
router.get("/", (_req: Request, res: Response) => {
  res.json(jobStore.getAll());
});

// GET /api/jobs/:jobId
router.get("/:jobId", (req: Request, res: Response) => {
  const job = jobStore.getById(req.params.jobId as string);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
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
