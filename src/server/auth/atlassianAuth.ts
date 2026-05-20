/**
 * Atlassian OAuth 2.0 (3LO) helper for Confluence + Jira.
 *
 * Flow:
 *   1. User configures CLIENT_ID + CLIENT_SECRET in Settings.
 *   2. UI calls GET /api/auth/atlassian/start → 302 to auth.atlassian.com
 *   3. Atlassian redirects back to /api/auth/atlassian/callback?code=…
 *   4. We exchange code → access_token + refresh_token + accessible resources (cloud_id)
 *   5. Tokens are persisted to .env; refreshed on demand when expired.
 */

import fs from "fs";
import path from "path";
import https from "https";
import { URLSearchParams } from "url";

const ENV_PATH = path.join(process.cwd(), ".env");

export interface AtlassianTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  cloudId: string;
  siteUrl: string;
  scope: string;
}

// Granular scopes — required by the Confluence v2 REST API. The classic
// scopes (read:confluence-content.all, …) only authorize the v1 API
// which Atlassian has now removed (HTTP 410 Gone).
export const ATLASSIAN_SCOPES = [
  // Confluence (granular)
  "read:space:confluence",
  "read:page:confluence",
  "write:page:confluence",
  "read:attachment:confluence",
  "write:attachment:confluence",
  "read:content-details:confluence",
  // Jira
  "read:jira-work",
  "write:jira-work",
  // Refresh tokens
  "offline_access",
].join(" ");

export const REDIRECT_URI = "http://localhost:3000/api/auth/atlassian/callback";
const AUTH_BASE = "https://auth.atlassian.com";
const API_BASE = "https://api.atlassian.com";

// ── env read/write ──────────────────────────────────────────────
function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function writeEnv(updates: Record<string, string>): void {
  const existing = readEnv();
  const merged = { ...existing, ...updates };
  const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
  // Reflect into current process.env so callers see fresh values
  for (const [k, v] of Object.entries(updates)) {
    if (v) process.env[k] = v;
  }
}

// ── HTTP helper ─────────────────────────────────────────────────
function httpsRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (response) => {
        let data = "";
        response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: data }));
        response.on("error", reject);
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Public API ──────────────────────────────────────────────────
export function getClientCredentials(): { clientId: string; clientSecret: string } | null {
  const env = readEnv();
  const id = env["ATLASSIAN_OAUTH_CLIENT_ID"];
  const secret = env["ATLASSIAN_OAUTH_CLIENT_SECRET"];
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

export function getStoredTokens(): AtlassianTokens | null {
  const env = readEnv();
  const access = env["ATLASSIAN_ACCESS_TOKEN"];
  const refresh = env["ATLASSIAN_REFRESH_TOKEN"];
  const expiresAt = parseInt(env["ATLASSIAN_EXPIRES_AT"] ?? "0", 10);
  const cloudId = env["ATLASSIAN_CLOUD_ID"];
  const siteUrl = env["ATLASSIAN_SITE_URL"];
  const scope = env["ATLASSIAN_SCOPE"] ?? "";
  if (!access || !refresh || !cloudId) return null;
  return { accessToken: access, refreshToken: refresh, expiresAt, cloudId, siteUrl: siteUrl ?? "", scope };
}

export function clearTokens(): void {
  writeEnv({
    ATLASSIAN_ACCESS_TOKEN: "",
    ATLASSIAN_REFRESH_TOKEN: "",
    ATLASSIAN_EXPIRES_AT: "",
    ATLASSIAN_CLOUD_ID: "",
    ATLASSIAN_SITE_URL: "",
    ATLASSIAN_SCOPE: "",
  });
}

export function buildAuthorizeUrl(state: string): string {
  const creds = getClientCredentials();
  if (!creds) throw new Error("ATLASSIAN_OAUTH_CLIENT_ID/SECRET ayarlanmamış.");
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: creds.clientId,
    scope: ATLASSIAN_SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
    response_type: "code",
    prompt: "consent",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForTokens(code: string): Promise<AtlassianTokens> {
  const creds = getClientCredentials();
  if (!creds) throw new Error("OAuth client credentials not configured");

  const tokenResp = await httpsRequest(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (tokenResp.status !== 200) {
    throw new Error(`Token exchange failed (${tokenResp.status}): ${tokenResp.body}`);
  }

  const tokens = JSON.parse(tokenResp.body) as TokenResponse;

  // Fetch accessible Atlassian sites (cloud IDs)
  const resourcesResp = await httpsRequest(`${API_BASE}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
  });

  if (resourcesResp.status !== 200) {
    throw new Error(`Accessible resources fetch failed (${resourcesResp.status})`);
  }

  const resources = JSON.parse(resourcesResp.body) as Array<{ id: string; url: string; name: string }>;
  if (!resources.length) {
    throw new Error("Bu OAuth uygulamasının erişebileceği Atlassian sitesi yok.");
  }

  // Use first site by default
  const site = resources[0]!;
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  const stored: AtlassianTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    cloudId: site.id,
    siteUrl: site.url,
    scope: tokens.scope,
  };

  writeEnv({
    ATLASSIAN_ACCESS_TOKEN: stored.accessToken,
    ATLASSIAN_REFRESH_TOKEN: stored.refreshToken,
    ATLASSIAN_EXPIRES_AT: String(stored.expiresAt),
    ATLASSIAN_CLOUD_ID: stored.cloudId,
    ATLASSIAN_SITE_URL: stored.siteUrl,
    ATLASSIAN_SCOPE: stored.scope,
  });

  return stored;
}

async function refreshTokens(current: AtlassianTokens): Promise<AtlassianTokens> {
  const creds = getClientCredentials();
  if (!creds) throw new Error("OAuth client credentials not configured");

  const resp = await httpsRequest(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: current.refreshToken,
    }),
  });

  if (resp.status !== 200) {
    throw new Error(`Token refresh failed (${resp.status}): ${resp.body}`);
  }

  const tokens = JSON.parse(resp.body) as TokenResponse;
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  const updated: AtlassianTokens = {
    ...current,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? current.refreshToken,
    expiresAt,
    scope: tokens.scope,
  };

  writeEnv({
    ATLASSIAN_ACCESS_TOKEN: updated.accessToken,
    ATLASSIAN_REFRESH_TOKEN: updated.refreshToken,
    ATLASSIAN_EXPIRES_AT: String(updated.expiresAt),
    ATLASSIAN_SCOPE: updated.scope,
  });

  return updated;
}

/**
 * Get a valid access token, refreshing if it expires within the next minute.
 * Throws if no tokens are stored or refresh fails.
 */
export async function getValidAccessToken(): Promise<{ accessToken: string; cloudId: string; siteUrl: string }> {
  const tokens = getStoredTokens();
  if (!tokens) {
    throw new Error("Atlassian bağlantısı yok. Ayarlar'dan OAuth ile bağlanın.");
  }
  if (tokens.expiresAt - Date.now() < 60_000) {
    const refreshed = await refreshTokens(tokens);
    return {
      accessToken: refreshed.accessToken,
      cloudId: refreshed.cloudId,
      siteUrl: refreshed.siteUrl,
    };
  }
  return { accessToken: tokens.accessToken, cloudId: tokens.cloudId, siteUrl: tokens.siteUrl };
}

export function getConfluenceApiBase(cloudId: string): string {
  return `${API_BASE}/ex/confluence/${cloudId}`;
}

export function getJiraApiBase(cloudId: string): string {
  return `${API_BASE}/ex/jira/${cloudId}`;
}
