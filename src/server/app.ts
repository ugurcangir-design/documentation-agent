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
import { env } from "../config/env";
import { csrfGuard } from "./middleware/csrfGuard";

const app = express();
const PORT = env.port;

// ── İlk-çalıştırma klasör garantisi ────────────────────────────────
// Temiz bir `git clone` sonrası bu klasörler YOK (`.gitignore`'da veya
// hiç oluşturulmamış). Çoğu kod yolu `mkdirSync(recursive)` ile kendi
// klasörünü açar, ama multer'ın `dest`'i (data/references/_tmp) request
// anında klasörü OLUŞTURMAZ — yoksa ilk doküman/şablon yüklemesi
// `ENOENT` ile patlar. Tüm gerekli klasörleri tek yerden, server
// dinlemeye başlamadan önce garantiye alıyoruz.
for (const dir of [
  "data/references/_tmp",
  "data/references/confluence",
  "data/references/documents",
  "data/references/templates",
  "data/db",
  "data/logs",
  "data/screenshots",
  "data/exports",
  "data/brd",
  "data/swagger",
]) {
  fs.mkdirSync(path.join(process.cwd(), dir), { recursive: true });
}

// CORS: yalnızca localhost / 127.0.0.1 / ::1 origin'lerine izin ver.
// Yerel uygulama; cross-origin script'in (örn. açık başka bir tarayıcı
// sekmesindeki kötü niyetli site) `fetch("http://localhost:3000/api/
// references")` ile metadata (Confluence sayfa başlıkları, şirket adı
// vb.) çekmesini engeller. Origin'siz istekler (curl/Postman) geçerli
// kabul edilir — CSRF guard mutation'ları zaten X-DocAgent ile koruyor.
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    try {
      const h = new URL(origin).hostname;
      const ok = h === "localhost" || h === "127.0.0.1" || h === "::1";
      cb(null, ok);
    } catch {
      cb(null, false);
    }
  },
}));
app.use(express.json({ limit: "10mb" }));
app.use(csrfGuard);

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
// Crash/uyku yedeği: sekme temiz kapanınca `pagehide` beacon → 30sn'de çıkar.
// Bu yedek yalnız beacon HİÇ gelmezse (tarayıcı çöktü / makine uzun uyudu /
// sekme askıya alındı) devreye girer. 15dk çok kısaydı: kullanıcı kısa süre
// uzaklaşınca (öğle arası, kısa uyku) sunucu ölüyor, dönünce "Failed to fetch"
// alıyordu. 60dk daha toleranslı; temiz kapanış zaten 30sn beacon ile hızlı.
const HEARTBEAT_FALLBACK = 60 * 60_000;  // 60 dk (çökme/uyku yedeği)
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

// Aktif (running/pending) job varsa server KAPANMAMALI — uzun süren bir
// doküman üretimi sırasında sekme kapanır/odak kaybederse iş ölmesin.
function hasActiveJob(): boolean {
  return jobStore.getAll().some((j) => j.status === "running" || j.status === "pending");
}

// Sent via navigator.sendBeacon on `pagehide`. A refresh fires this too,
// so we wait out a grace period — the reloaded page's first heartbeat
// cancels the countdown. Only a real tab close leaves no reconnect.
app.post("/api/heartbeat/leave", (_req, res) => {
  res.json({ ok: true });
  if (leaveTimer) return; // already counting down
  const check = () => {
    if (hasActiveJob()) {
      console.log("[server] sekme kapandı ama aktif job var — çıkış ertelendi");
      leaveTimer = setTimeout(check, LEAVE_GRACE); // job bitince tekrar dene
      return;
    }
    console.log("[server] browser tab closed (no reconnect) — exiting");
    process.exit(0);
  };
  leaveTimer = setTimeout(check, LEAVE_GRACE);
});

setInterval(() => {
  if (lastHeartbeat && Date.now() - lastHeartbeat > HEARTBEAT_FALLBACK) {
    if (hasActiveJob()) return; // aktif job varken çökme-yedeği çıkışı ertele
    console.log("[server] no heartbeat for 15min — exiting (crash fallback)");
    process.exit(0);
  }
}, CHECK_INTERVAL);

// ── Job runtime watchdog ──────────────────────────────────────────
// Bir job belirli süredir progress.updatedAt güncellemiyorsa "hung"
// kabul edilir → cancel + failed işaretle. Eskiden createdAt'tan
// 30dk sabit eşik vardı; bu büyük (40-80 ekran) job'ları orta üretimde
// öldürüyordu. Şimdi: STALE eşiği `updatedAt`'a bağlı (3 saat hareketsizlik).
// HARD üst sınır da var (12 saat) — yalnızca gerçekten kaçak süreçler için.
//
// updatedAt her ekran tamamlandığında / progress event'inde tazelenir
// (jobStore.update otomatik set ediyor), dolayısıyla iyi çalışan büyük
// işler asla bu eşiklere takılmaz.
const JOB_STALE_MS = 3 * 60 * 60_000;   // 3 saat: ilerleme yoksa hung
const JOB_HARD_MAX_MS = 12 * 60 * 60_000; // 12 saat: ne olursa olsun durdur
setInterval(() => {
  const now = Date.now();
  for (const job of jobStore.getAll()) {
    if (job.status !== "running") continue;
    const startedAt = new Date(job.createdAt).getTime();
    const lastSeen = new Date(job.updatedAt).getTime();
    const totalAge = now - startedAt;
    const idleAge = now - lastSeen;
    const hung = idleAge >= JOB_STALE_MS;
    const tooOld = totalAge >= JOB_HARD_MAX_MS;
    if (!hung && !tooOld) continue;

    const reason = tooOld
      ? `12 saat hard limit — job yine de devam ediyordu`
      : `${Math.round(idleAge / 60_000)}dk ilerleme yok (stale watchdog)`;
    console.log(`[watchdog] ${job.id}: ${reason}`);
    jobCancellation.cancel(job.id);
    jobStore.update(job.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: `Watchdog tarafından sonlandırıldı: ${reason}`,
      progress: { ...job.progress, message: `Watchdog: ${reason}` },
    });
  }
}, 5 * 60_000); // 5 dk'da bir kontrol — eski 1dk gereksiz sıktı

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
