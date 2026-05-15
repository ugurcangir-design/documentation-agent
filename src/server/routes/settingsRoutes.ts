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
    const val = trimmed.slice(eq + 1).trim();
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
  for (const section of sections) {
    lines.push(section.comment);
    for (const key of section.keys) {
      lines.push(`${key}=${values[key] ?? ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// GET /api/settings
router.get("/", (_req: Request, res: Response) => {
  let values: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    values = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
  }

  // Mask secrets for display
  const masked = { ...values };
  for (const key of ["ANTHROPIC_API_KEY", "APP_PASSWORD", "CONFLUENCE_API_TOKEN", "ATLASSIAN_OAUTH_CLIENT_SECRET", "ATLASSIAN_ACCESS_TOKEN", "ATLASSIAN_REFRESH_TOKEN"]) {
    if (masked[key] && masked[key].length > 4) {
      masked[key] = masked[key].slice(0, 4) + "••••••••••••";
    }
  }

  res.json({ values: masked, configured: Object.keys(values).filter(k => !!values[k]) });
});

// POST /api/settings
router.post("/", (req: Request, res: Response) => {
  const incoming = req.body as Record<string, string>;

  let existing: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    existing = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
  }

  // Don't overwrite secrets if placeholder mask is sent
  for (const key of ["ANTHROPIC_API_KEY", "APP_PASSWORD", "CONFLUENCE_API_TOKEN", "ATLASSIAN_OAUTH_CLIENT_SECRET", "ATLASSIAN_ACCESS_TOKEN", "ATLASSIAN_REFRESH_TOKEN"]) {
    if (incoming[key]?.includes("••••")) {
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
