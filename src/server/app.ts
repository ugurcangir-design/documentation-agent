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
import sourceRoutes from "./routes/sourceRoutes";
import statsRoutes from "./routes/statsRoutes";
import authRoutes from "./routes/authRoutes";
import { jobStore } from "./store/jobStore";
import { jobCancellation } from "./store/jobCancellation";
import maintenanceRoutes from "./routes/maintenanceRoutes";
import updateRoutes from "./routes/updateRoutes";

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
app.use("/api/sources", sourceRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/update", updateRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ── Heartbeat / auto-shutdown ──────────────────────────────────────
// The local app must close when its browser tab is *closed*, but stay
// open on a refresh and while the tab is merely idle / in the
// background. Two independent signals make that distinction reliable:
//
//  1. `pagehide` beacon → the tab is going away. This fires on a
//     refresh AND on a real close, but NOT on backgrounding the tab.
//     On receipt we start a short grace countdown; if a heartbeat
//     arrives before it fires, the tab came back (refresh, or another
//     tab is still open) and we cancel. If nothing reconnects, the tab
//     was truly closed → exit.
//
//  2. Heartbeat every 10s → liveness. A long fallback timeout only
//     covers abnormal exits (browser crash, OS kill) where `pagehide`
//     never fires. It is deliberately long so a backgrounded tab —
//     whose timers the browser throttles hard — is never mistaken for
//     a closed one.
let lastHeartbeat: number | null = null;
let leaveTimer: NodeJS.Timeout | null = null;

const LEAVE_GRACE = 30_000;              // tab gone → exit unless a tab reconnects
const HEARTBEAT_FALLBACK = 15 * 60_000;  // crash fallback (survives bg throttling)
const CHECK_INTERVAL = 30_000;

app.post("/api/heartbeat", (_req, res) => {
  lastHeartbeat = Date.now();
  // A live tab is talking to us → it did not leave after all.
  if (leaveTimer) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  res.json({ ok: true });
});

// Sent via navigator.sendBeacon on `pagehide`. A refresh fires this too,
// so we wait out a grace period — the reloaded page's first heartbeat
// cancels the countdown. Only a real tab close leaves no reconnect.
app.post("/api/heartbeat/leave", (_req, res) => {
  res.json({ ok: true });
  if (leaveTimer) return; // already counting down
  leaveTimer = setTimeout(() => {
    console.log("[server] browser tab closed (no reconnect) — exiting");
    process.exit(0);
  }, LEAVE_GRACE);
});

setInterval(() => {
  if (lastHeartbeat && Date.now() - lastHeartbeat > HEARTBEAT_FALLBACK) {
    console.log("[server] no heartbeat for 15min — exiting (crash fallback)");
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
