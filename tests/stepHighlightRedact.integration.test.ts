import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

// 1) Adım vurgusu: action-buton tıklanmadan ÖNCE 'Adım: "…" (konumu işaretli)'
//    state'i yakalanmalı (Scribe deseni) ve overlay sonrasında DOM'dan kalkmalı.
// 2) Redaction: REDACT_SENSITIVE=true iken e-posta/telefon içeren öğeler
//    yakalama öncesi blur almalı; false iken DOM'a dokunulmamalı.

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Step Test</title>
<style>body{font-family:sans-serif;padding:20px}button{margin:6px;padding:10px 16px}
.ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:9999}
.bx{background:#fff;padding:40px;border-radius:8px}</style></head><body>
<h1>Kayıtlar</h1>
<p id="mail">İletişim: destek@ornek-firma.com</p>
<p id="tel">Telefon: +90 532 123 45 67</p>
<p id="plain">Bu satırda hassas veri yok.</p>
<button type="button" onclick="document.getElementById('m').style.display='flex'">Yeni Ekle</button>
<div id="m" role="dialog" class="ov"><div class="bx">EKLEME MODALI
  <button type="button" aria-label="close" onclick="document.getElementById('m').style.display='none'">×</button>
</div></div>
</body></html>`;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(PAGE_HTML);
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const dir = path.join(process.cwd(), "data", "screenshots");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("steptest_") || f.startsWith("redacttest_")) fs.unlinkSync(path.join(dir, f));
    }
  }
});

describe("Adım vurgusu + redaction (entegrasyon)", () => {
  it("tıklamadan önce 'Adım:' state'i yakalanır; overlay yakalama sonrası DOM'dan kalkar", async () => {
    process.env.DEEP_EXPLORE = "false";
    process.env.FILL_TEST_DATA = "false";
    process.env.ANNOTATE_STEPS = "true";
    delete process.env.REDACT_SENSITIVE;

    let chromium: typeof import("playwright").chromium;
    try { ({ chromium } = await import("playwright")); }
    catch { console.warn("playwright yok — test atlandı"); return; }

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      const { exploreInteractiveStates } = await import("../src/browser/interactiveExplorer");
      const states = await exploreInteractiveStates(page, "steptest_screen");

      const stepState = states.find((s) => s.label.startsWith("Adım:"));
      expect(stepState, "'Adım: …' vurgu state'i yakalanmalı").toBeDefined();
      expect(stepState!.label).toContain("Yeni Ekle");
      // Modal state'i de mevcut olmalı (vurgu, normal akışı BOZMAMALI).
      expect(states.some((s) => s.label.startsWith("Modal:"))).toBe(true);
      // Overlay keşif bittiğinde DOM'da kalmamalı.
      const overlayCount = await page.locator("#__docagent_step_highlight__").count();
      expect(overlayCount).toBe(0);
    } finally {
      await browser.close();
      delete process.env.ANNOTATE_STEPS;
    }
  }, 60_000);

  it("REDACT_SENSITIVE=true → e-posta/telefon öğeleri blur alır, temiz satır almaz; false → DOM'a dokunulmaz", async () => {
    let chromium: typeof import("playwright").chromium;
    try { ({ chromium } = await import("playwright")); }
    catch { console.warn("playwright yok — test atlandı"); return; }

    const { captureScreenshot } = await import("../src/browser/screenshotCapture");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      // Kapalıyken: hiçbir öğe işaretlenmez.
      delete process.env.REDACT_SENSITIVE;
      await captureScreenshot(page, "redacttest_off");
      expect(await page.locator("[data-docagent-redacted]").count()).toBe(0);

      // Açıkken: e-posta + telefon blur alır; hassas veri içermeyen satır almaz.
      process.env.REDACT_SENSITIVE = "true";
      await captureScreenshot(page, "redacttest_on");
      const mailBlur = await page.locator("#mail").evaluate((el) => (el as HTMLElement).style.filter);
      const telBlur = await page.locator("#tel").evaluate((el) => (el as HTMLElement).style.filter);
      const plainBlur = await page.locator("#plain").evaluate((el) => (el as HTMLElement).style.filter);
      expect(mailBlur).toContain("blur");
      expect(telBlur).toContain("blur");
      expect(plainBlur).not.toContain("blur");
    } finally {
      await browser.close();
      delete process.env.REDACT_SENSITIVE;
    }
  }, 60_000);
});
