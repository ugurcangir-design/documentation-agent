/**
 * Yerel CSRF guard. DocAgent yerel bir uygulamadır ama Express CORS
 * `*` ile açık olduğu için herhangi bir tarayıcı sekmesinde açık olan
 * kötü niyetli site, `fetch("http://localhost:3000/api/settings", …)`
 * ile bizim mutasyon endpoint'lerimizi tetikleyebilir. Buna izin
 * vermemek için her **mutasyon** isteğinde `X-DocAgent: 1` header'ı
 * şart koşulur — bu **simple-CORS olmayan** bir header'dır,
 * dolayısıyla cross-origin bir site preflight (OPTIONS) atmak
 * zorundadır; preflight yanıtımız bu header'a izin vermediği için
 * istek tarayıcı tarafında bloklanır.
 *
 * Muafiyetler:
 *   - GET/HEAD/OPTIONS — okuma; idempotent.
 *   - Atlassian OAuth callback/start — harici browser redirect'idir,
 *     header ekleyemez.
 *   - /api/heartbeat/leave — `navigator.sendBeacon` ile gönderilir,
 *     custom header eklemez. Etki "sunucu kapanır" (veri kaybı yok);
 *     yine de Origin kontrolüyle aynı-origin şartı uygulanır.
 */

import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PATHS = new Set([
  "/api/auth/atlassian/callback",
  "/api/auth/atlassian/start",
]);
const BEACON_PATH = "/api/heartbeat/leave";

function originIsLocal(req: Request): boolean {
  const origin = req.get("origin") ?? req.get("referer") ?? "";
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  // sendBeacon edge case — beacon header ekleyemez, fakat browser her
  // zaman Origin gönderir. Aynı-origin ise geçir.
  if (req.path === BEACON_PATH) {
    if (originIsLocal(req)) return next();
    res.status(403).json({ error: "Forbidden (beacon: bad origin)" });
    return;
  }

  if (req.get("x-docagent") === "1") return next();

  res.status(403).json({
    error: "Forbidden — DocAgent yalnızca kendi UI'sından çağrılabilir (X-DocAgent header eksik)",
  });
}
