import type { Request, Response, NextFunction } from "express";

/**
 * Güvenlik/sızıntı duvarı — her yanıta savunma başlıkları ekler.
 *
 * DocAgent yerel bir uygulama olsa da yanıtları hassas şirket verisi
 * (üretilen kılavuzlar, Confluence/Jira metadata, ayar durumu) içerir.
 * Bu başlıklar tarayıcı tarafı sızıntı/manipülasyon vektörlerini kapatır:
 *
 *  - X-Content-Type-Options: nosniff → MIME-sniffing ile içeriğin farklı
 *    tip (örn. script) olarak yorumlanmasını engeller.
 *  - X-Frame-Options: DENY → uygulamanın kötü niyetli bir sitede iframe'e
 *    gömülüp clickjacking'e maruz kalmasını engeller.
 *  - Referrer-Policy: no-referrer → dış bir kaynağa gidilse bile yerel
 *    URL/parametreler Referer başlığında sızmaz.
 *  - X-Permitted-Cross-Domain-Policies: none → Flash/PDF cross-domain
 *    politika istismarını kapatır.
 *
 * /api altındaki yanıtlar ayrıca `no-store` ile işaretlenir: hassas API
 * çıktıları tarayıcı/disk önbelleğine yazılmaz (paylaşılan makinede veya
 * yedeğe düşen cache'te sızıntı önlenir).
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }

  next();
}
