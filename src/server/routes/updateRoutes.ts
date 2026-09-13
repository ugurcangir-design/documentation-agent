import { Router, type Request, type Response } from "express";
import { spawn, execFileSync } from "child_process";
import path from "path";
import fs from "fs";

const router = Router();
const PROJECT_ROOT = process.cwd();

// GÜVENLİK: git komutları shell'siz (execFileSync + argüman dizisi) çalışır —
// argümanlar bir shell tarafından yorumlanmadığı için `;`, `$(...)`, backtick
// gibi metakarakterler enjeksiyon oluşturamaz (eski `execSync(\`git ${args}\`)`
// string-interpolation'ının aksine).
function git(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

// Git ref-adı güvenli alt kümesi. `rev-parse --abbrev-ref HEAD` normalde
// güvenli döner; yine de defense-in-depth olarak fetch/rev-list'e geçmeden
// önce doğrula (git ref adları teoride bazı metakarakterlere izin verir).
function safeBranch(name: string): string {
  return /^[A-Za-z0-9._\/-]{1,200}$/.test(name) && !name.includes("..") ? name : "main";
}

// GET /api/update/info — current commit info
router.get("/info", (_req: Request, res: Response) => {
  const hash = git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const fullHash = git(["rev-parse", "HEAD"]) || "unknown";
  const date = git(["log", "-1", "--format=%cI"]) || "";
  const message = git(["log", "-1", "--format=%s"]) || "";
  const branch = safeBranch(git(["rev-parse", "--abbrev-ref", "HEAD"]) || "main");
  const author = git(["log", "-1", "--format=%an"]) || "";

  // Check if there's a newer commit on origin
  let behind = 0;
  let remoteHash = "";
  try {
    git(["fetch", "origin", branch]);
    behind = parseInt(git(["rev-list", "--count", `HEAD..origin/${branch}`]) || "0", 10);
    remoteHash = git(["rev-parse", `origin/${branch}`]) || "";
  } catch {
    // Network failure — keep behind=0
  }

  res.json({
    hash,
    fullHash,
    date,
    message,
    branch,
    author,
    behind,
    remoteHash,
    upToDate: behind === 0,
  });
});

// POST /api/update/run — spawn the detached update script
router.post("/run", (_req: Request, res: Response) => {
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "update.sh");
  if (!fs.existsSync(scriptPath)) {
    res.status(500).json({ error: "update.sh bulunamadı" });
    return;
  }

  try {
    // Spawn fully detached so it survives this process being killed by
    // the script itself when it restarts the servers.
    const child = spawn("bash", [scriptPath], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    res.json({ ok: true, pid: child.pid });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/update/log — tail of the update log
router.get("/log", (_req: Request, res: Response) => {
  const logPath = path.join(PROJECT_ROOT, "data", "logs", "update.log");
  if (!fs.existsSync(logPath)) {
    res.json({ lines: [] });
    return;
  }
  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n").slice(-80);
  res.json({ lines });
});

export default router;
