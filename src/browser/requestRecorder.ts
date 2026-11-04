/**
 * Deterministik network kaydedici (Faz 1). Keşif sırasında sayfanın
 * tetiklediği aynı-origin XHR/fetch isteklerini toplar; her state push'unda
 * "son etkileşimden bu yana" biriken istekler o state'in kanıtı olur.
 *
 * GÜVENLİK/GİZLİLİK:
 *  - Header'lar HİÇ tutulmaz (Authorization/cookie sızmaz).
 *  - Gövde değerleri tutulmaz; yalnız JSON üst düzey ANAHTARLAR.
 *  - Query değerleri PII/sır kalıplarına göre maskelenir (e-posta, telefon,
 *    11 hane kimlik, uzun token, APP_PASSWORD / API anahtarları).
 *  - Statik varlıklar (css/js/img/font/media) elenir.
 *
 * 0 LLM token — tamamen Playwright olay dinleyicisi.
 */

import type { Page, Request } from "playwright";
import { env } from "../config/env";
import type { NetRequest } from "../types/behavior";

const SKIP_RESOURCE = new Set(["stylesheet", "image", "font", "media", "script", "manifest", "texttrack", "eventsource", "websocket"]);
/** Üçüncü-taraf telemetri/izleme — ekran davranışı değil, kanıt olarak alınmaz. */
/** Arka plan polling/akış uçları — etkileşimin sonucu değildir, kanıt olmaz. */
const DENY_PATH = /(notification|\/stream\b|heartbeat|\/ping\b|\/health\b|\/poll\b|\/events\b|\/ws\b|\/socket|\/_next\/)/i;
/** Framework iç fetch'leri (Next.js RSC gezinmesi vb.). */
const DENY_QUERY_KEYS = new Set(["_rsc", "_next"]);
const DENY_HOST = /(google-analytics|googletagmanager|gstatic|doubleclick|facebook|hotjar|segment\.io|sentry\.io|intercom|mixpanel|clarity\.ms|newrelic|datadog)/i;
const MAX_BUFFER = 60;
const MAX_QUERY_KEYS = 40;

/** Hassas görünen query değerini maskele; anahtar korunur. */
export function maskValue(key: string, value: string): string {
  const v = value ?? "";
  const k = key.toLowerCase();
  if (/pass|pwd|secret|token|auth|key|otp|pin/.test(k)) return "***";
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) return "***@***";
  if (/^\+?\d[\d\s().-]{9,16}\d$/.test(v)) return "***";          // telefon
  if (/^\d{11}$/.test(v)) return "***";                             // TCKN benzeri
  if (/^TR\d{2}[\d\s]{20,30}$/i.test(v)) return "***";              // IBAN
  if (/^[A-Za-z0-9+/=_-]{32,}$/.test(v)) return "***";              // uzun token/base64
  const secrets = [env.appPassword, process.env.ANTHROPIC_API_KEY, env.confluenceApiToken]
    .filter((s): s is string => !!s && s.length >= 4);
  for (const s of secrets) if (v.includes(s)) return "***";
  return v.length > 120 ? v.slice(0, 117) + "…" : v;
}

function toNetRequest(req: Request, status?: number): NetRequest | null {
  try {
    const u = new URL(req.url());
    const query: Record<string, string> = {};
    let n = 0;
    for (const [k, v] of u.searchParams.entries()) {
      if (n++ >= MAX_QUERY_KEYS) break;
      query[k] = maskValue(k, v);
    }
    let bodyKeys: string[] | undefined;
    const pd = req.postData();
    if (pd) {
      try {
        const parsed = JSON.parse(pd) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          bodyKeys = Object.keys(parsed as Record<string, unknown>).slice(0, MAX_QUERY_KEYS);
        }
      } catch {
        // form-urlencoded → anahtarları al
        if (/^[^=&]+=[^&]*(&[^=&]+=[^&]*)*$/.test(pd)) {
          bodyKeys = pd.split("&").map((p) => decodeURIComponent(p.split("=")[0] ?? "")).filter(Boolean).slice(0, MAX_QUERY_KEYS);
        }
      }
    }
    return {
      method: req.method().toUpperCase(),
      host: u.host,
      path: u.pathname,
      query,
      ...(bodyKeys && bodyKeys.length > 0 ? { bodyKeys } : {}),
      ...(status !== undefined ? { status } : {}),
      resourceType: req.resourceType(),
    };
  } catch {
    return null;
  }
}

export interface RequestRecorder {
  /** Son drain'den bu yana biriken istekleri döndürür ve tamponu boşaltır. */
  drain(): NetRequest[];
  /** Tamponu kaydetmeden boşaltır (ör. navigasyon öncesi gürültü). */
  reset(): void;
  detach(): void;
}

/**
 * Sayfaya kaydedici bağlar. Yalnız `page` origin'iyle aynı host'a giden
 * (veya relative) ve statik olmayan istekler tutulur.
 */
export function attachRequestRecorder(page: Page): RequestRecorder {
  let buffer: NetRequest[] = [];
  let origin = "";
  try { origin = new URL(page.url()).origin; } catch { /* about:blank */ }

  // requestfinished → istek tamamlandı; status'ü doğrudan response'tan al.
  // (Ayrı bir "response" dinleyicisiyle eşlemek güvenilmez: Playwright'ta
  // response olayı requestfinished'den ÖNCE gelir, istek henüz tamponda olmaz.)
  const onFinished = async (req: Request) => {
    try {
      const rt = req.resourceType();
      if (SKIP_RESOURCE.has(rt)) return;
      const u = new URL(req.url());
      if (DENY_HOST.test(u.host) || DENY_PATH.test(u.pathname)) return;
      for (const k of u.searchParams.keys()) if (DENY_QUERY_KEYS.has(k)) return;
      // Sayfa origin'i navigasyonla değişebilir (login→app) → güncel origin.
      try { origin = new URL(page.url()).origin; } catch { /* noop */ }
      // API/BFF çoğunlukla AYRI alt alan adındadır (ör. uat-app.x.dev → uat-app-bff
      // -service.x.dev). xhr/fetch her origin'den alınır (telemetri hariç); diğer
      // kaynak türlerinde (document vb.) yalnız aynı-origin.
      const isApi = rt === "xhr" || rt === "fetch";
      if (!isApi && origin && u.origin !== origin) return;
      let status: number | undefined;
      try { status = (await req.response())?.status(); } catch { /* yanıt yok (failed) */ }
      const nr = toNetRequest(req, status);
      if (!nr) return;
      if (buffer.length >= MAX_BUFFER) buffer.shift();
      buffer.push(nr);
    } catch { /* kaydedici asla keşfi düşürmez */ }
  };

  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFinished);

  return {
    drain() { const out = buffer; buffer = []; return out; },
    reset() { buffer = []; },
    detach() {
      try { page.off("requestfinished", onFinished); } catch { /* noop */ }
      try { page.off("requestfailed", onFinished); } catch { /* noop */ }
      buffer = [];
    },
  };
}
