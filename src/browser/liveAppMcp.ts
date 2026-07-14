/**
 * Canlı uygulama kanıtı — Claude'a `@playwright/mcp` üzerinden GERÇEK bir
 * tarayıcı verip hedef ekranı kendisinin gezmesini, DOM'u ve network (CRUD)
 * davranışını gözlemlemesini sağlar. `userManualGenerator`'a ek — ve en
 * güvenilir — kanıt olarak beslenir (DocAgent'ın Playwright-heuristic keşfi
 * ekran görüntüsü yakalamayı AYNEN sürdürür; bu modül onun yerine geçmez).
 *
 * `claude` CLI'ın `--mcp-config`/`--strict-mcp-config`/`--allowedTools`
 * argümanlarıyla bir Playwright MCP sunucusuna bağlanma deseni kullanılır —
 * DocAgent'ın zaten kullandığı CLI backend'e (bkz. claudeClient.ts) ek
 * argümanlarla, ayrı bir agent SDK/entegrasyon gerekmeden.
 *
 * Opt-in: `LIVE_APP_MCP_ENABLED=true` olmadan hiç tetiklenmez. Hata/timeout
 * durumunda pipeline'ı DURDURMAZ — `null` döner, üretim kanıtsız devam eder.
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";

import { env } from "../config/env";
import { callClaude } from "../llm/claudeClient";
import { writeJsonAtomic, readJsonSafe } from "../server/store/atomicJson";
import type { DiscoveredScreen } from "../types/screen";

const LIVE_APP_DIR = path.join(process.cwd(), "data", "references", "live-app");
const PROFILE_DIR = path.join(process.cwd(), "data", ".live-app-profile");
const MCP_CONFIG_PATH = path.join(process.cwd(), "data", ".mcp.live-app.json");
const CACHE_INDEX_PATH = path.join(LIVE_APP_DIR, "_index.json");

// Cache formatı/prompt'u değiştiğinde artır — eski kanıtlar otomatik geçersiz
// kalır (analysisCache.ts'teki ANALYZER_VERSION deseniyle aynı mantık).
const EVIDENCE_VERSION = "v1";

// claude -p'ye açıkça izin verilen tarayıcı araçları — bilinçli DAR bir
// allowlist. Listede OLMAYAN araç headless modda REDDEDİLİR (izin
// sorulamaz). browser_evaluate (keyfi JS) ve dosya yükleme bilinçli olarak
// DIŞARIDA — gözlem + temel etkileşim yeter, saldırı yüzeyi büyümez.
export const LIVE_APP_ALLOWED_TOOLS = [
  "mcp__playwright__browser_navigate",
  "mcp__playwright__browser_navigate_back",
  "mcp__playwright__browser_snapshot",
  "mcp__playwright__browser_network_requests",
  "mcp__playwright__browser_network_request",
  "mcp__playwright__browser_console_messages",
  "mcp__playwright__browser_click",
  "mcp__playwright__browser_type",
  "mcp__playwright__browser_press_key",
  "mcp__playwright__browser_hover",
  "mcp__playwright__browser_select_option",
  "mcp__playwright__browser_wait_for",
  "mcp__playwright__browser_handle_dialog",
  "mcp__playwright__browser_tabs",
  "mcp__playwright__browser_find",
];

/** `npx` ikilisini PATH sanitize edilmişken de bulur (paketlenmiş Electron
 *  app'te GUI PATH'i minimal olabilir) — `resolveClaudeBin` ile aynı desen. */
function resolveNpxBin(): string {
  const configured = "npx";
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = path.join(dir, configured);
    if (fs.existsSync(candidate)) return candidate;
  }
  const home = os.homedir();
  const fallbacks = [
    "/usr/local/bin/npx",
    "/opt/homebrew/bin/npx",
    path.join(home, ".nvm", "current", "bin", "npx"),
  ];
  for (const f of fallbacks) {
    if (fs.existsSync(f)) return f;
  }
  return configured; // spawn ENOENT ile patlayabilir — fetchLiveAppEvidence bunu yakalar
}

/** MCP config'i idempotent yazar — mutlak npx yoluyla, PATH'e bağımlı değil. */
function ensureMcpConfig(): string {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const npxBin = resolveNpxBin();
  const cfg = {
    mcpServers: {
      playwright: {
        command: npxBin,
        args: [
          "-y", "@playwright/mcp@latest",
          "--headless", "--browser", "chrome",
          "--user-data-dir", PROFILE_DIR,
        ],
      },
    },
  };
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
  return MCP_CONFIG_PATH;
}

/** Playwright aynı --user-data-dir'i tek seferde yalnızca BİR süreçte
 *  açabilir. Önceki çağrı temiz kapanmadıysa (crash, SIGKILL'siz kesme)
 *  SingletonLock yetim kalır ve sonraki her MCP çağrısı askıda kalır.
 *  Self-heal: kilit sahibi PID'e SIGTERM + kısa poll, sonra SIGKILL. */
function cleanupProfileLock(): void {
  const lockPath = path.join(PROFILE_DIR, "SingletonLock");
  let pid: number | null = null;
  try {
    const target = fs.readlinkSync(lockPath); // format: "<hostname>-<pid>"
    const m = /-(\d+)$/.exec(target);
    if (m) pid = parseInt(m[1]!, 10);
  } catch {
    return; // kilit yok — temiz durumdayız
  }
  if (!pid) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // süreç zaten yok — yalnız kalıntı dosyaları temizle
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // hâlâ yaşıyor mu? (sinyal göndermez, kontrol eder)
    } catch {
      break; // süreç kapandı
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // zaten kapanmış
  }
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch { /* yoksa sorun değil */ }
  }
}

// Tüm live-app MCP çağrılarını job içinde SERİLEŞTİRİR — documentationJob
// ekranları CONCURRENCY=3 ile paralel işler, aynı --user-data-dir'e eşzamanlı
// birden fazla Playwright süreci profil kilidine çarpar. Ekran üretiminin
// geri kalanı yine paralel kalır, yalnız MCP tarayıcı turu sıraya girer.
let liveAppChain: Promise<unknown> = Promise.resolve();
function withLiveAppLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = liveAppChain.then(fn, fn);
  liveAppChain = run.catch(() => {});
  return run;
}

/** Export edilmiştir — yalnız test'lerin cache dosya adını tahmin edebilmesi için. */
export function hashPath(screenPath: string): string {
  return crypto.createHash("sha256").update(EVIDENCE_VERSION + screenPath).digest("hex").slice(0, 16);
}

interface CacheIndex {
  [hash: string]: { screenPath: string; cachedAt: string };
}

function readCache(hash: string): string | null {
  const file = path.join(LIVE_APP_DIR, `${hash}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}

function writeCache(hash: string, screenPath: string, content: string): void {
  fs.mkdirSync(LIVE_APP_DIR, { recursive: true });
  fs.writeFileSync(path.join(LIVE_APP_DIR, `${hash}.md`), content, "utf-8");
  const index = readJsonSafe<CacheIndex>(CACHE_INDEX_PATH, {});
  index[hash] = { screenPath, cachedAt: new Date().toISOString() };
  writeJsonAtomic(CACHE_INDEX_PATH, index);
}

function buildTaskPrompt(screen: DiscoveredScreen): string {
  const loginLine = env.appUsername && env.appPassword
    ? `Giriş (login) duvarına düşersen şu bilgilerle gir: kullanıcı adı "${env.appUsername}", şifre "${env.appPassword}". Giriş bilgisi tanımlı değilse login denemeden bunu net şekilde raporla.`
    : "Giriş bilgisi tanımlı değil — login duvarına düşersen denemeden net şekilde raporla.";

  return `Aşağıdaki gerçek uygulama ekranını Playwright MCP araçlarıyla ziyaret et: ${screen.url}

${loginLine}

Görevin: bu ekranı gerçek bir kullanıcı gibi gez — TÜM sekmeleri, ve mümkünse
her CRUD akışını (ekle/düzenle/sil/görüntüle) gerçekten dene. Her aksiyon için:
1. Tetiklenen network isteğini (yöntem + path, kısa özet — browser_network_requests/
   browser_network_request ile) raporla.
2. Ekranda görülen doğrulama/başarı/hata mesajını (varsa) birebir metniyle raporla.
3. browser_snapshot ile DOM'da gördüğün ama ekran görüntüsünden anlaşılmayabilecek
   yapısal detayları (gizli alan, disabled buton, tooltip metni vb.) not et.

**UYDURMA YASAK — EN ÖNEMLİ KURAL:** Yalnız GERÇEKTEN gözlemlediğini yaz.
Bir aksiyonu deneyemediysen (yetki yok, veri yok, zaman yetmedi) bunu açıkça
belirt — tahmin etme. Kısa, madde işaretli, kaynak belirtir bir Markdown rapor
döndür (uzun anlatı değil — bu rapor başka bir üretim adımına ham kanıt olarak
girecek).`;
}

/**
 * Ekran için canlı uygulama kanıtı toplar. Kapalıyken/hatada `null` döner —
 * çağıran taraf (screenProcessor) bunu fatal saymamalı, MCP'siz üretime
 * normal şekilde devam etmeli.
 */
export async function fetchLiveAppEvidence(screen: DiscoveredScreen): Promise<string | null> {
  if (!env.liveAppMcpEnabled) return null;
  if (env.claudeBackend !== "cli") {
    console.warn("[live-app-mcp] yalnız CLI backend'de desteklenir (CLAUDE_BACKEND=api) — atlanıyor");
    return null;
  }

  const hash = hashPath(screen.path);
  const cached = readCache(hash);
  if (cached) {
    console.log(`[live-app-mcp] önbellekten okundu: ${screen.path}`);
    return cached;
  }

  return withLiveAppLock(async () => {
    // Kilit iki nedenle burada tekrar kontrol edilir: (1) kuyrukta beklerken
    // başka bir worker aynı ekranı işlemiş olabilir, (2) her turdan önce
    // temiz başlangıç garantisi gerekir.
    const cachedAfterWait = readCache(hash);
    if (cachedAfterWait) return cachedAfterWait;

    try {
      cleanupProfileLock();
      const mcpConfigPath = ensureMcpConfig();
      console.log(`[live-app-mcp] '${screen.path}' için canlı gözlem başlıyor…`);

      const result = await callClaude({
        prompt: buildTaskPrompt(screen),
        maxTokens: 4000,
        mcpConfigPath,
        allowedTools: LIVE_APP_ALLOWED_TOOLS,
        timeoutMs: env.liveAppMcpTimeoutMs,
      });

      const text = result.text.trim();
      if (!text) return null;
      writeCache(hash, screen.path, text);
      console.log(`[live-app-mcp] '${screen.path}' için kanıt toplandı (${text.length} karakter)`);
      return text;
    } catch (e) {
      console.warn(`[live-app-mcp] '${screen.path}' için kanıt toplanamadı — MCP'siz devam ediliyor: ${(e as Error).message}`);
      return null;
    }
  });
}

// Test/tanılama amaçlı — npx erişilebilir mi hızlı kontrol.
export function isNpxAvailable(): boolean {
  try {
    execFileSync(resolveNpxBin(), ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
