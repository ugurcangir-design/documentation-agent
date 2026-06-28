import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

const router = Router();
const ENV_PATH = path.join(process.cwd(), ".env");

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip inline comments unless the value is quoted
    if (!val.startsWith('"') && !val.startsWith("'")) {
      const hashIdx = val.indexOf("#");
      if (hashIdx > 0) val = val.slice(0, hashIdx).trim();
    }
    result[key] = val;
  }
  return result;
}

function buildEnv(values: Record<string, string>): string {
  const sections = [
    {
      comment: "# Claude backend",
      keys: ["CLAUDE_BACKEND", "CLAUDE_CLI_BIN", "ANTHROPIC_API_KEY"],
    },
    {
      comment: "# Hedef uygulama",
      keys: ["APP_BASE_URL", "APP_USERNAME", "APP_PASSWORD"],
    },
    {
      comment: "# Atlassian OAuth 2.0 (Confluence + Jira)",
      keys: [
        "ATLASSIAN_OAUTH_CLIENT_ID",
        "ATLASSIAN_OAUTH_CLIENT_SECRET",
        "CONFLUENCE_SPACE_KEY",
        "CONFLUENCE_PARENT_PAGE_ID",
      ],
    },
    {
      comment: "# Confluence — legacy API token (OAuth yoksa fallback)",
      keys: [
        "CONFLUENCE_BASE_URL",
        "CONFLUENCE_EMAIL",
        "CONFLUENCE_API_TOKEN",
      ],
    },
    {
      comment: "# Agent ayarları",
      keys: ["MAX_DISCOVERY_DEPTH", "PORT", "FIX_UP_THRESHOLD", "FIX_UP_MAX_PASSES", "DOC_LANGUAGE"],
    },
  ];

  const lines: string[] = [];
  const known = new Set<string>();
  for (const section of sections) {
    lines.push(section.comment);
    for (const key of section.keys) {
      lines.push(`${key}=${values[key] ?? ""}`);
      known.add(key);
    }
    lines.push("");
  }

  // Preserve any keys not in our schema (e.g. ATLASSIAN_ACCESS_TOKEN,
  // ATLASSIAN_REFRESH_TOKEN, etc. written by other modules).
  const extras = Object.keys(values).filter((k) => !known.has(k) && values[k]);
  if (extras.length > 0) {
    lines.push("# Diğer (otomatik üretilen)");
    for (const k of extras) lines.push(`${k}=${values[k]}`);
    lines.push("");
  }

  return lines.join("\n");
}

const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "APP_PASSWORD",
  "CONFLUENCE_API_TOKEN",
  "ATLASSIAN_OAUTH_CLIENT_SECRET",
  "ATLASSIAN_ACCESS_TOKEN",
  "ATLASSIAN_REFRESH_TOKEN",
];

/**
 * Kullanıcının POST /api/settings ile yazabileceği env key allowlist.
 *
 * Allowlist olmazsa client `{"PATH": "/evil/bin"}` ya da `{"NODE_OPTIONS":
 * "--require ./malicious.js"}` POST edip `.env`'e ve `process.env`'e
 * sızdırabilir → bir sonraki spawn'da kod yürütme. CSRF guard ana
 * savunma; bu allowlist defense-in-depth.
 *
 * ATLASSIAN_ACCESS_TOKEN/REFRESH_TOKEN gibi OAuth-yazılı alanlar bu
 * allowlist'te YOK — onları atlassianAuth.writeEnv kendisi yazar; user
 * UI'sından gelmemeli.
 */
const ALLOWED_SETTINGS_KEYS = new Set<string>([
  // Claude
  "CLAUDE_BACKEND", "CLAUDE_CLI_BIN", "ANTHROPIC_API_KEY",
  // Hedef uygulama
  "APP_BASE_URL", "APP_USERNAME", "APP_PASSWORD",
  // Atlassian OAuth credentials (token'lar değil — onları auth flow yazar)
  "ATLASSIAN_OAUTH_CLIENT_ID", "ATLASSIAN_OAUTH_CLIENT_SECRET",
  "CONFLUENCE_SPACE_KEY", "CONFLUENCE_PARENT_PAGE_ID",
  // Confluence legacy fallback
  "CONFLUENCE_BASE_URL", "CONFLUENCE_EMAIL", "CONFLUENCE_API_TOKEN",
  // Agent ayarları
  "MAX_DISCOVERY_DEPTH", "PORT", "DOC_LANGUAGE",
  "FIX_UP_THRESHOLD", "FIX_UP_MAX_PASSES", "COVERAGE_LLM_JUDGE",
  "FILL_TEST_DATA", "ALLOW_FORM_SUBMIT", "DEEP_EXPLORE",
  "TAB_GEN_CONCURRENCY", "CLAUDE_CLI_TIMEOUT_MS",
]);

/** Newline injection guard — env value içinde \n veya \r olamaz; aksi
 *  halde `.env` parser'ı yeni bir KEY=val satırı olarak yorumlar. */
function hasInjection(value: string): boolean {
  return /[\r\n]/.test(value);
}

// GET /api/settings — secrets are NEVER returned (return empty string).
// The `configured` list tells the UI which secrets are already saved.
router.get("/", (_req: Request, res: Response) => {
  let values: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    values = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
  }

  const safe = { ...values };
  for (const key of SECRET_KEYS) {
    if (safe[key]) safe[key] = "";
  }

  res.json({
    values: safe,
    configured: Object.keys(values).filter((k) => !!values[k]),
  });
});

// POST /api/settings
router.post("/", (req: Request, res: Response) => {
  const raw = (req.body ?? {}) as Record<string, unknown>;

  // Allowlist + string + newline-injection guard. Bilinmeyen key sessizce
  // atılır (UI'da görünmeyen key zaten gelmemeli; gelseydi en olası
  // sebep saldırı veya hata).
  const incoming: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_SETTINGS_KEYS.has(k)) { rejected.push(k); continue; }
    if (typeof v !== "string") { rejected.push(k); continue; }
    if (hasInjection(v)) {
      res.status(400).json({ error: `'${k}' değeri satır sonu içeremez` });
      return;
    }
    incoming[k] = v;
  }
  if (rejected.length > 0) {
    console.warn(`[settings] allowlist dışı/geçersiz key'ler atıldı: ${rejected.join(", ")}`);
  }

  let existing: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    existing = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
  }

  // For secrets: if the user left the field empty AND there's already a saved
  // value, keep the existing one. (Also still strip legacy '••••' placeholders.)
  for (const key of SECRET_KEYS) {
    const v = incoming[key];
    if (v === undefined) continue;
    if (v === "" || v.includes("••••")) {
      incoming[key] = existing[key] ?? "";
    }
  }

  const merged = { ...existing, ...incoming };
  // 0o600 — yalnız sahibi okusun. macOS multi-user veya .env'in Dropbox/
  // iCloud sync'ine düşmesi senaryolarında credential sızıntısını engeller.
  // writeFileSync({mode}) yalnız dosya **oluşturulurken** uygulanır; var
  // olan dosyanın mode'unu değiştirmez → chmod ile zorla.
  fs.writeFileSync(ENV_PATH, buildEnv(merged), { encoding: "utf-8", mode: 0o600 });
  try { fs.chmodSync(ENV_PATH, 0o600); } catch { /* best effort */ }

  // Reflect every change (including deletes) into process.env so the
  // running server picks them up immediately via the lazy env getters.
  for (const [k, v] of Object.entries(merged)) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }

  res.json({ ok: true });
});

export default router;
