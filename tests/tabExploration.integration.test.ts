import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

// URL-tabanlı sekme (?tab=N) simülasyonunun GERÇEKTEN çalıştığını kanıtlayan
// entegrasyon testi: 3 sekmeli, her sekmesi FARKLI içerik gösteren küçük bir
// site ayağa kaldırılır; exploreInteractiveStates her sekmeye gidip ayrı ayrı
// ve birbirinden FARKLI ekran görüntüsü almalı.

// Sekme içeriğini ?tab=N'e göre döndüren minik HTTP sunucu.
function tabHtml(n: number): string {
  const rows = Array.from({ length: 4 }, (_, r) => `<tr><td>Sekme ${n} · Satır ${r}</td><td>Değer ${n}${r}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Test</title>
  <style>body{font-family:sans-serif;padding:20px}[role=tab]{display:inline-block;padding:10px 18px;margin-right:6px;border:1px solid #ccc;text-decoration:none;color:#333}.active{background:#0a7;color:#fff}table{margin-top:20px;border-collapse:collapse}td{border:1px solid #ccc;padding:8px 14px}</style>
  </head><body>
  <div role="tablist">
    <a role="tab" href="/?tab=0" class="${n === 0 ? "active" : ""}">Market</a>
    <a role="tab" href="/?tab=1" class="${n === 1 ? "active" : ""}">Player</a>
    <a role="tab" href="/?tab=2" class="${n === 2 ? "active" : ""}">Accumulator</a>
  </div>
  <h1>${["Market", "Player", "Accumulator"][n]} Sekmesi</h1>
  <button type="button">Yeni Ekle (Sekme ${n})</button>
  <table><tbody>${rows}</tbody></table>
  </body></html>`;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://localhost");
    const tab = parseInt(u.searchParams.get("tab") || "0", 10);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(tabHtml(Number.isFinite(tab) ? tab : 0));
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  // Test sırasında üretilen PNG'leri temizle.
  const dir = path.join(process.cwd(), "data", "screenshots");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("tabtest_")) fs.unlinkSync(path.join(dir, f));
    }
  }
});

describe("URL-tabanlı sekme keşfi (entegrasyon)", () => {
  it("her sekmeye (?tab=0/1/2) gidip FARKLI ekran görüntüsü yakalar", async () => {
    // Derin keşif kapalı + form doldurma kapalı → hızlı ve deterministik;
    // testin amacı sekme NAVİGASYONU ve farklı içerik yakalama.
    process.env.DEEP_EXPLORE = "false";
    process.env.FILL_TEST_DATA = "false";

    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      console.warn("playwright yok — test atlandı");
      return;
    }

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      const { exploreInteractiveStates } = await import("../src/browser/interactiveExplorer");
      const states = await exploreInteractiveStates(page, "tabtest_screen");

      const tabState = (i: number) => states.find((s) => s.screenshotPath.includes(`tabtest_screen_tab_${i}.png`));
      const t0 = tabState(0), t1 = tabState(1), t2 = tabState(2);

      // Üç sekme de ayrı yakalanmış olmalı.
      expect(t0, "tab_0 yakalanmalı").toBeTruthy();
      expect(t1, "tab_1 yakalanmalı").toBeTruthy();
      expect(t2, "tab_2 yakalanmalı").toBeTruthy();

      // KRİTİK: her sekmenin görseli BİRBİRİNDEN FARKLI olmalı (içerik farklı).
      expect(t0!.screenshotBase64).not.toBe(t1!.screenshotBase64);
      expect(t1!.screenshotBase64).not.toBe(t2!.screenshotBase64);
      expect(t0!.screenshotBase64).not.toBe(t2!.screenshotBase64);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
