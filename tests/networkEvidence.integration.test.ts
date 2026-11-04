import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";

// Faz 1 — deterministik network kanıtı: keşif, formu doldurup "Ara"ya basınca
// tetiklenen aynı-origin fetch isteğini (path + query ANAHTARLARI) ilgili
// state'in `evidence.requests`'ine bağlamalı; doldurulan alanlar `formValues`
// olarak gelmeli. Fikstür, "ID doluysa diğer filtreler GÖNDERİLMEZ" kuralını
// simüle eder (kullanıcının gerçek örneği) — Faz 2 probe'ları bunu çıkaracak.
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket Explorer</title>
<style>body{font-family:sans-serif;padding:20px}input,button{margin:6px;padding:8px}</style></head><body>
<h1>Ticket Explorer</h1>
<form id="f" onsubmit="return false">
  <label>Ticket ID <input type="text" name="ticketId" placeholder="Ticket ID"></label>
  <label>Retailer ID <input type="text" name="retailerId" placeholder="Retailer ID"></label>
  <label>Player ID <input type="text" name="playerId" placeholder="Player ID"></label>
  <button type="button" id="ara" onclick="search()">Ara</button>
</form>
<div id="out">sonuç yok</div>
<table><thead><tr><th>Ticket</th></tr></thead><tbody><tr><td>—</td></tr></tbody></table>
<script>
function search(){
  const f=document.getElementById('f');
  const p=new URLSearchParams();
  // KURAL: ticketId doluysa yalnız o gönderilir; diğerleri yok sayılır.
  if(f.ticketId.value){ p.set('ticketId',f.ticketId.value); }
  else { for(const k of ['retailerId','playerId']) if(f[k].value) p.set(k,f[k].value); }
  p.set('page','0'); p.set('size','20');
  fetch('/api/tickets?'+p.toString()).then(r=>r.json()).then(j=>{document.getElementById('out').textContent='sonuç: '+j.count;});
}
</script></body></html>`;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url && req.url.startsWith("/api/tickets")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ count: 1, q: req.url }));
      return;
    }
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
      if (f.startsWith("netev_")) fs.unlinkSync(path.join(dir, f));
    }
  }
});

describe("Faz 1 — network kanıtı (entegrasyon)", () => {
  it("Ara'ya basınca tetiklenen /api/tickets isteği state kanıtına bağlanır", async () => {
    process.env.DEEP_EXPLORE = "false";
    process.env.FILL_TEST_DATA = "true";
    process.env.ANNOTATE_STEPS = "false";

    let chromium: typeof import("playwright").chromium;
    try { ({ chromium } = await import("playwright")); }
    catch { console.warn("playwright yok — test atlandı"); return; }

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      const { exploreInteractiveStates } = await import("../src/browser/interactiveExplorer");
      const out: { behaviors?: import("../src/types/behavior").BehaviorFact[] } = {};
      const states = await exploreInteractiveStates(page, "netev_screen", undefined, out);

      // Tanı: hangi state hangi isteği taşıyor?
      for (const s of states) {
        const reqs = (s.evidence?.requests ?? []).map((r) => `${r.method} ${r.path}?${Object.keys(r.query).join(",")}`);
        if (reqs.length) console.log(`   [kanıt] ${s.label} → ${reqs.join(" | ")}`);
      }
      // En az bir state'te /api/tickets isteği kanıt olarak bulunmalı (herhangi bir pass).
      const allReqs = states.flatMap((s) => s.evidence?.requests ?? []).filter((r) => r.path === "/api/tickets");
      expect(allReqs.length).toBeGreaterThan(0);
      expect(allReqs.every((r) => r.method === "GET" && r.status === 200)).toBe(true);
      // DOLU formla yapılan arama: ticketId var, diğer filtreler YOK (fikstür kuralı).
      const filledReq = allReqs.find((r) => "ticketId" in r.query);
      expect(filledReq, "dolu-form aramasının isteği yakalanmalı").toBeTruthy();
      expect(filledReq!.query).not.toHaveProperty("retailerId");
      expect(filledReq!.query).not.toHaveProperty("playerId");

      // Dolu-form state'i formValues taşımalı (etiket → değer).
      const filled = states.find((s) => s.evidence?.formValues && Object.keys(s.evidence.formValues).length > 0);
      expect(filled).toBeTruthy();

      // Faz 2: deneyler fikstür kuralını türetmeli — "Ticket ID doluyken Retailer/Player gönderilmez".
      const facts = out.behaviors ?? [];
      for (const f of facts) console.log(`   [kural] ${f.kind}/${f.confidence}: ${f.statement}`);
      const prec = facts.find((f) => f.kind === "filter-precedence");
      expect(prec, "filter-precedence kuralı türetilmeli").toBeTruthy();
      expect(prec!.confidence).toBe("high");
      expect(prec!.statement).toMatch(/Ticket ID/);
      expect(facts.some((f) => f.kind === "pagination")).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
