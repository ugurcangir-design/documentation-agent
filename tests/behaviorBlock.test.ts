import { describe, it, expect } from "vitest";
import { buildBehaviorBlock, formatBehaviorSource } from "../src/generator/behaviorBlock";
import type { BehaviorFact } from "../src/types/behavior";

const base = (over: Partial<BehaviorFact>): BehaviorFact => ({
  id: "b1", screenPath: "/t", kind: "filter-precedence",
  statement: '"Ticket ID" alanı doluyken "Retailer ID" filtresi isteğe dahil edilmez.',
  evidence: { note: "A+B doluyken istekte yalnız ticketId var" }, source: "observed", confidence: "high", ...over,
});

describe("buildBehaviorBlock (Faz 4)", () => {
  it("kural yoksa boş döner (bölüm uydurulmasın)", () => {
    expect(buildBehaviorBlock([])).toBe("");
  });
  it("kaynak/güvenilirlik etiketi, kanıt notu ve atıf içerir; çelişkiyi işaretler", () => {
    const b = buildBehaviorBlock([
      base({ source: "both", refs: [{ type: "jira_task", id: "MBSOPS-251", title: "MBSOPS-251 — Ticket Explorer" }] }),
      base({ id: "b2", source: "reference", confidence: "medium", conflict: true, kind: "required-field",
        statement: "Tarih aralığı zorunludur.", evidence: { note: "yalnız referans" }, refs: [{ type: "brd", id: "brd_1", title: "Filtreler" }] }),
    ]);
    expect(b).toContain("# GÖZLEMLENEN DAVRANIŞ KURALLARI");
    expect(b).toContain("[GÖZLEM+REFERANS · yüksek]");
    expect(b).toContain("Kanıt: A+B doluyken istekte yalnız ticketId var");
    expect(b).toContain("Kaynak: Canlı gözlem (keşif deneyi); Jira MBSOPS-251");
    expect(b).toContain("[YALNIZ REFERANS · orta · ⚠ ÇELİŞKİ]");
    expect(b).toContain("UYDURMA");
  });
  it("yalnız-referans kaynağında 'Canlı gözlem' yazmaz", () => {
    expect(formatBehaviorSource(base({ source: "reference", refs: [{ type: "confluence", id: "confluence_1", title: "X" }] })))
      .toBe("Confluence confluence_1 (X)");
  });
});
