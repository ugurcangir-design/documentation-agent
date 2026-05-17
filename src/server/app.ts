import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";

import discoveryRoutes from "./routes/discoveryRoutes";
import jobRoutes from "./routes/jobRoutes";
import documentRoutes from "./routes/documentRoutes";
import confluenceRoutes from "./routes/confluenceRoutes";
import exportRoutes from "./routes/exportRoutes";
import settingsRoutes from "./routes/settingsRoutes";
import promptRoutes from "./routes/promptRoutes";
import referenceRoutes from "./routes/referenceRoutes";
import statsRoutes from "./routes/statsRoutes";
import authRoutes from "./routes/authRoutes";
import { jobStore } from "./store/jobStore";
import { jobCancellation } from "./store/jobCancellation";
import maintenanceRoutes from "./routes/maintenanceRoutes";

const app = express();
const PORT = process.env["PORT"] || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve screenshots as static files
app.use(
  "/screenshots",
  express.static(path.join(process.cwd(), "data", "screenshots"))
);

// API routes
app.use("/api/discovery", discoveryRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/confluence", confluenceRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/prompts", promptRoutes);
app.use("/api/references", referenceRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/maintenance", maintenanceRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ── Heartbeat / auto-shutdown ──────────────────────────────────────
// Browser sends a heartbeat every 10s. If no heartbeat for 90s,
// process exits → supervisor kills Vite → all gone.
// 90s tolerates: browser tab refresh, brief network drops, OS sleep
// awakening, browser background-tab throttling.
let lastHeartbeat: number | null = null;
const HEARTBEAT_TIMEOUT = 90_000;
const CHECK_INTERVAL = 15_000;

app.post("/api/heartbeat", (_req, res) => {
  lastHeartbeat = Date.now();
  res.json({ ok: true });
});

setInterval(() => {
  if (lastHeartbeat && Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
    console.log("[server] no heartbeat for 90s, exiting");
    process.exit(0);
  }
}, CHECK_INTERVAL);

// ── Job runtime watchdog ──────────────────────────────────────────
// Any job that has been 'running' for more than JOB_MAX_AGE is
// considered hung. We cancel it, then mark it 'failed' so the UI
// stops showing a perpetual spinner. The cancellation is honored
// at the next checkpoint (see jobCancellation.isCancelled() in
// documentationJob/discoveryJob).
const JOB_MAX_AGE_MS = 30 * 60_000; // 30 dakika
setInterval(() => {
  const now = Date.now();
  for (const job of jobStore.getAll()) {
    if (job.status !== "running") continue;
    const startedAt = new Date(job.createdAt).getTime();
    if (now - startedAt < JOB_MAX_AGE_MS) continue;

    console.log(`[watchdog] ${job.id} 30dk'dır çalışıyor, iptal ediliyor`);
    jobCancellation.cancel(job.id);
    jobStore.update(job.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: "Job 30 dakikadan uzun süredir çalışıyordu — watchdog tarafından sonlandırıldı",
      progress: { ...job.progress, message: "Watchdog tarafından sonlandırıldı" },
    });
  }
}, 60_000);

// Serve React build in production
const clientBuild = path.join(
  process.cwd(),
  "client",
  "dist"
);

if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));

  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(clientBuild, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      message:
        "Documentation Agent API. Run `cd client && npm run dev` for the UI.",
    });
  });
}

// ── Reap orphaned 'running' jobs from a previous process ─────────
// Any job marked 'running' at startup is by definition dead — the
// in-memory execution state did not survive the restart, so it
// cannot continue to make progress. Mark them 'failed' on boot so
// the UI stops showing a perpetual spinner.
{
  const allJobsAtBoot = jobStore.getAll();
  let reaped = 0;
  for (const j of allJobsAtBoot) {
    if (j.status === "running" || j.status === "pending") {
      jobStore.update(j.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: "Sunucu yeniden başlatıldı — bu job tamamlanmadan kesildi",
        progress: { ...j.progress, message: "Sunucu yeniden başlatıldı (orphan)" },
      });
      reaped++;
    }
  }
  if (reaped > 0) console.log(`[boot] ${reaped} orphan job 'failed' olarak işaretlendi`);
}

app.listen(PORT, () => {
  console.log(`\n Documentation Agent Server`);
  console.log(`  API  → http://localhost:${PORT}/api`);
  console.log(`  UI   → http://localhost:${PORT} (production build)`);
  console.log(`\n  For development: cd client && npm run dev`);
});

export default app;
