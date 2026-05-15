import { Router, type Request, type Response } from "express";
import { v4 as uuid } from "uuid";

import { jobStore } from "../store/jobStore";
import { screenStore } from "../store/screenStore";
import { eventBus } from "../store/eventBus";
import { runDiscoveryJob } from "../jobs/discoveryJob";

const router = Router();

// POST /api/discovery/start
router.post("/start", (req: Request, res: Response) => {
  const extraUrls: string[] = req.body?.extraUrls ?? [];

  const jobId = uuid();

  jobStore.create({
    id: jobId,
    type: "discovery",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: { current: 0, total: 0, message: "Bekliyor..." },
  });

  // Run in background — don't await
  runDiscoveryJob(jobId, extraUrls).catch((err) => {
    console.error("Discovery job failed:", err.message);
  });

  res.json({ jobId });
});

// GET /api/discovery/screens
router.get("/screens", (_req: Request, res: Response) => {
  const screens = screenStore.getAll();
  res.json(screens);
});

// GET /api/discovery/:jobId/stream — SSE
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

  // Send current job status immediately
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
