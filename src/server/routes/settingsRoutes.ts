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
      keys: ["MAX_DISCOVERY_DEPTH", "PORT"],
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
  const incoming = req.body as Record<string, string>;

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
  fs.writeFileSync(ENV_PATH, buildEnv(merged), "utf-8");

  // Reload into process.env
  for (const [k, v] of Object.entries(merged)) {
    if (v) process.env[k] = v;
  }

  res.json({ ok: true });
});

export default router;
