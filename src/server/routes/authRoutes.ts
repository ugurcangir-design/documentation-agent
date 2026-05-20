import { Router, type Request, type Response } from "express";
import crypto from "crypto";

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getStoredTokens,
  getClientCredentials,
  clearTokens,
  getValidAccessToken,
  REDIRECT_URI,
  ATLASSIAN_SCOPES,
} from "../auth/atlassianAuth";

const router = Router();

// Pending OAuth states (in-memory, short-lived)
const pendingStates = new Map<string, number>();
const STATE_TTL = 10 * 60 * 1000;

function cleanupStates(): void {
  const cutoff = Date.now() - STATE_TTL;
  for (const [k, v] of pendingStates) {
    if (v < cutoff) pendingStates.delete(k);
  }
}

// GET /api/auth/atlassian/status
router.get("/atlassian/status", async (_req: Request, res: Response) => {
  const creds = getClientCredentials();
  const tokens = getStoredTokens();

  res.json({
    clientConfigured: !!creds,
    connected: !!tokens,
    siteUrl: tokens?.siteUrl ?? null,
    cloudId: tokens?.cloudId ?? null,
    scope: tokens?.scope ?? null,
    expiresAt: tokens?.expiresAt ?? null,
    redirectUri: REDIRECT_URI,
    scopes: ATLASSIAN_SCOPES,
  });
});

// GET /api/auth/atlassian/start → redirect to authorize
router.get("/atlassian/start", (_req: Request, res: Response) => {
  cleanupStates();
  try {
    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now());
    const url = buildAuthorizeUrl(state);
    res.redirect(url);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /api/auth/atlassian/callback?code=…&state=…
router.get("/atlassian/callback", async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

  if (oauthError) {
    res.status(400).send(htmlError(`Atlassian reddi: ${oauthError}`));
    return;
  }

  if (!code || !state || !pendingStates.has(state)) {
    res.status(400).send(htmlError("Geçersiz veya süresi dolmuş istek (state). Yeniden deneyin."));
    return;
  }

  pendingStates.delete(state);

  try {
    const tokens = await exchangeCodeForTokens(code);
    res.send(htmlSuccess(tokens.siteUrl));
  } catch (err) {
    res.status(500).send(htmlError((err as Error).message));
  }
});

// POST /api/auth/atlassian/disconnect
router.post("/atlassian/disconnect", (_req: Request, res: Response) => {
  clearTokens();
  res.json({ ok: true });
});

// GET /api/auth/atlassian/test — make a probe API call
// Uses the Confluence v1 REST API (/wiki/rest/api/space) which is
// compatible with the classic OAuth scopes we request. The v2 API
// (/wiki/api/v2/spaces) needs granular scopes and would return
// '401 scope does not match'.
router.get("/atlassian/test", async (_req: Request, res: Response) => {
  try {
    const { accessToken, cloudId } = await getValidAccessToken();
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/space?limit=1`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) {
      res.json({ ok: false, status: resp.status, body: await resp.text() });
      return;
    }
    const data = await resp.json() as { results?: unknown[]; size?: number };
    res.json({
      ok: true,
      sampleSpaceCount: data.results?.length ?? data.size ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── HTML responses for browser redirect ───────────────────────────
function htmlSuccess(siteUrl: string): string {
  return `<!doctype html><meta charset="utf-8">
<title>Bağlandı</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f3f4f6}
.card{background:#fff;border:1px solid #d1d5db;border-radius:14px;padding:32px 40px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.06)}
.icon{width:48px;height:48px;border-radius:50%;background:#10b981;color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:24px}
h1{margin:0 0 6px;font-size:18px;color:#111827}
p{margin:4px 0;color:#6b7280;font-size:13px}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px}</style>
<div class="card">
  <div class="icon">✓</div>
  <h1>Atlassian'a bağlandı</h1>
  <p>Site: <code>${siteUrl}</code></p>
  <p style="margin-top:14px">Bu pencereyi kapatabilirsiniz.</p>
</div>
<script>setTimeout(() => window.close(), 1500);</script>`;
}

function htmlError(msg: string): string {
  return `<!doctype html><meta charset="utf-8">
<title>Hata</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f3f4f6}
.card{background:#fff;border:1px solid #fecaca;border-radius:14px;padding:32px 40px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,.06)}
h1{margin:0 0 8px;font-size:18px;color:#991b1b}
p{margin:0;color:#374151;font-size:13px;word-break:break-word}</style>
<div class="card">
  <h1>OAuth Hatası</h1>
  <p>${msg.replace(/</g, "&lt;")}</p>
</div>`;
}

export default router;
