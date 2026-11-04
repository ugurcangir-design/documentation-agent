import { describe, it, expect } from "vitest";
import { inferBehaviors, inferFromStateEvidence, type ProbeRun } from "../src/quality/behaviorInference";
import type { NetRequest } from "../src/types/behavior";

const req = (query: Record<string, string>): NetRequest => ({ method: "GET", path: "/api/tickets", query, status: 200 });

describe("inferBehaviors (Faz 2 saf çıkarım)", () => {
  it("ID doluyken diğer filtre gönderilmiyorsa filter-precedence (high) üretir", () => {
    const runs: ProbeRun[] = [
      { id: "empty", filled: {}, request: req({ page: "0", size: "20" }) },
      { id: "single:Ticket ID", filled: { "Ticket ID": "533" }, request: req({ ticketId: "533", page: "0", size: "20" }) },
      { id: "single:Retailer ID", filled: { "Retailer ID": "4" }, request: req({ retailerId: "4", page: "0", size: "20" }) },
      { id: "combo:Ticket ID+Retailer ID", filled: { "Ticket ID": "533", "Retailer ID": "4" }, request: req({ ticketId: "533", page: "0", size: "20" }) },
    ];
    const facts = inferBehaviors("/ticket-explorer", runs);
    const prec = facts.find((f) => f.kind === "filter-precedence");
    expect(prec).toBeTruthy();
    expect(prec!.confidence).toBe("high");
    expect(prec!.statement).toContain('"Ticket ID" alanı doluyken "Retailer ID" filtresi isteğe dahil edilmez');
    expect(prec!.source).toBe("observed");
    expect(prec!.evidence.requests?.length).toBe(3);
    // boş arama serbest + sayfalama da türetilmeli
    expect(facts.some((f) => f.kind === "required-field" && /tüm kayıtları/.test(f.statement))).toBe(true);
    expect(facts.some((f) => f.kind === "pagination")).toBe(true);
  });

  it("iki filtre de gönderiliyorsa filter-combine üretir", () => {
    const runs: ProbeRun[] = [
      { id: "empty", filled: {}, request: req({ page: "0" }) },
      { id: "single:Ad", filled: { Ad: "x" }, request: req({ name: "x", page: "0" }) },
      { id: "single:Durum", filled: { Durum: "A" }, request: req({ status: "A", page: "0" }) },
      { id: "combo:Ad+Durum", filled: { Ad: "x", Durum: "A" }, request: req({ name: "x", status: "A", page: "0" }) },
    ];
    const facts = inferBehaviors("/x", runs);
    expect(facts.some((f) => f.kind === "filter-combine" && f.confidence === "high")).toBe(true);
    expect(facts.some((f) => f.kind === "filter-precedence")).toBe(false);
  });

  it("boş aramada istek yoksa zorunlu-filtre kuralı; eşleme bilinmiyorsa kural UYDURMAZ", () => {
    const runs: ProbeRun[] = [
      { id: "empty", filled: {}, message: "En az bir filtre giriniz" },
      { id: "single:ID", filled: { ID: "1" }, request: req({ id: "1" }) },
      // B'nin tek-alan deneyi yok → combo için eşleme eksik → kural çıkmamalı
      { id: "combo:ID+Ad", filled: { ID: "1", Ad: "x" }, request: req({ id: "1" }) },
    ];
    const facts = inferBehaviors("/y", runs);
    const reqd = facts.find((f) => f.kind === "required-field");
    expect(reqd?.statement).toContain("en az bir filtre");
    expect(reqd?.statement).toContain("En az bir filtre giriniz");
    expect(facts.some((f) => f.kind === "filter-precedence")).toBe(false);
  });

  it("geçersiz değer: mesaj varsa high, istek yoksa medium, ikisi de yoksa kural YOK", () => {
    const withMsg = inferBehaviors("/v", [{ id: "validation:ID", filled: { ID: "abc!" }, message: "Sayısal değer giriniz" }]);
    expect(withMsg.find((f) => f.kind === "validation")?.confidence).toBe("high");
    const noReq = inferBehaviors("/v", [{ id: "validation:ID", filled: { ID: "abc!" } }]);
    expect(noReq.find((f) => f.kind === "validation")?.confidence).toBe("medium");
    const fired = inferBehaviors("/v", [{ id: "validation:ID", filled: { ID: "abc!" }, request: req({ id: "abc!" }) }]);
    expect(fired.some((f) => f.kind === "validation")).toBe(false);
  });

  it("state kanıtından sıralama / sayfalama / detay / modal kuralları türetir", () => {
    const st = (label: string, path: string, query: Record<string, string>) =>
      ({ label, triggeredBy: "", screenshotPath: "", screenshotBase64: "", evidence: { requests: [{ method: "GET", path, query, status: 200 }] } });
    const facts = inferFromStateEvidence("/t", [
      st('Sıralama: "Ticket ID"', "/bff/ticket", { page: "0", size: "50", sortBy: "ticketId", sortDirection: "asc" }),
      st('Kayıt detay ekranı: "518"', "/bff/ticket/518", {}),
      st('Modal: "View" (satır)', "/bff/ticket/518", {}),
    ] as any);
    expect(facts.find((f) => f.kind === "sort")?.statement).toMatch(/sortBy, sortDirection/);
    expect(facts.find((f) => f.kind === "pagination")?.statement).toMatch(/sayfa başına 50/);
    expect(facts.filter((f) => f.kind === "navigation").length).toBe(2);
    expect(facts.find((f) => /detay ekranını açar/.test(f.statement))?.statement).toMatch(/\/bff\/ticket\/\{id\}/);
  });
});
