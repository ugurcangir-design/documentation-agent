import { describe, it, expect } from "vitest";
import { computeBehaviorCoverage, isBehaviorCovered } from "../src/quality/behaviorCoverage";
import type { BehaviorFact } from "../src/types/behavior";

const prec: BehaviorFact = {
  id: "1", screenPath: "/t", kind: "filter-precedence",
  statement: '"Ticket ID" alanı doluyken "Retailer ID" filtresi isteğe dahil edilmez — Ticket ID ile arama diğer filtreyi geçersiz kılar.',
  evidence: {}, source: "observed", confidence: "high",
};
const pag: BehaviorFact = { id: "2", screenPath: "/t", kind: "pagination",
  statement: "Liste sayfalama ile gelir; sayfa/boyut parametreleri isteğe eklenir (page, size).", evidence: {}, source: "observed", confidence: "medium" };

describe("behaviorCoverage (Faz 5)", () => {
  it("kural kullanıcı diliyle anlatılmışsa kapsanır (etiket + tür sinyali)", () => {
    const body = "Ticket ID alanına değer girip Ara'ya bastığınızda Retailer ID gibi diğer filtreler dikkate alınmaz; yalnızca ID'ye göre sonuç gelir.";
    expect(isBehaviorCovered(prec, body)).toBe(true);
  });
  it("etiketler geçse bile tür sinyali yoksa kapsanmaz (salt bahis yetmez)", () => {
    const body = "Ekranda Ticket ID ve Retailer ID filtreleri bulunur.";
    expect(isBehaviorCovered(prec, body)).toBe(false);
  });
  it("rapor: eksikleri listeler ve yüzdeyi hesaplar", () => {
    const body = "Kayıtlar sayfalama ile listelenir; sayfa başına kayıt sayısını seçebilirsiniz.";
    const r = computeBehaviorCoverage([prec, pag], body);
    expect(r.total).toBe(2); expect(r.covered).toBe(1); expect(r.pct).toBe(50);
    expect(r.missing[0]!.id).toBe("1");
  });
});
