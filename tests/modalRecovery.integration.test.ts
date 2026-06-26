import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

// Kapatılamayan bir modal action-button keşfini DURDURMAMALI: closeModal
// başarısız olursa sayfa reload edilip kalan butonlar yine yakalanır.
// Fixture: "Detay" tıkanmış (kapatılamaz) modal açar; "Düzenle" normal modal.
// Eski davranış (break) olsaydı "Düzenle" hiç yakalanmazdı.

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Modal Test</title>
<style>body{font-family:sans-serif;padding:20px}button{margin:6px;padding:10px 16px}
.ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:9999}
.bx{background:#fff;padding:40px;border-radius:8px}</style></head><body>
<h1>Kayıt Listesi</h1>
<button type="button" onclick="document.getElementById('stuck').style.display='flex'">Detayı Aç</button>
<button type="button" onclick="document.getElementById('normal').style.display='flex'">Kaydı Düzenle</button>
<div id="stuck" role="dialog" class="ov"><div class="bx">TIKANMIŞ MODAL — kapatma yolu yok</div></div>
<div id="normal" role="dialog" class="ov"><div class="bx">DÜZENLE MODAL
  <button type="button" aria-label="close" onclick="document.getElementById('normal').style.display='none'">×</button>
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
      if (f.startsWith("modaltest_")) fs.unlinkSync(path.join(dir, f));
    }
  }
});

describe("Kapatılamayan modal kurtarma (entegrasyon)", () => {
  it("modal kapanmazsa reload edip kalan action butonlarını yine yakalar", async () => {
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
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      const { exploreInteractiveStates } = await import("../src/browser/interactiveExplorer");
      const states = await exploreInteractiveStates(page, "modaltest_screen");

      // Tıkanmış modalden SONRAKİ buton ("Düzenle") de yakalanmış olmalı —
      // yani pass erken durmamış (reload ile kurtarılmış).
      const labels = states.map((s) => s.label.toLowerCase());
      const captTikanmis = labels.some((l) => l.includes("detay"));
      const captDuzenle = labels.some((l) => l.includes("düzenle"));

      expect(captTikanmis, "tıkanmış modali açan buton yakalanmalı").toBe(true);
      expect(captDuzenle, "tıkanmış modalden SONRAKİ buton da yakalanmalı (erken durmamalı)").toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
