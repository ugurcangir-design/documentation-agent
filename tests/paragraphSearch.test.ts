import { describe, it, expect } from "vitest";
import { searchParagraphs } from "../src/retrieval/paragraphSearch";
import type { DocumentSection } from "../src/types/documentSource";

const sec = (title: string, content: string): DocumentSection => ({
  id: `s-${title}`,
  sourceId: "src",
  sourceType: "brd",
  sourceFile: "src",
  title,
  content,
});

describe("searchParagraphs", () => {
  it("minHits altındaki paragrafları döndürmez", () => {
    const sections = [
      sec("A", "Bu paragrafta sadece etkinlik kelimesi geçer ve başka yok. " +
        "Paragraf yeterince uzun olmalı ki regex'e takılsın ve hits sayılsın."),
    ];
    const out = searchParagraphs(sections, "etkinlik filtre yönetim", { minHits: 2 });
    expect(out).toEqual([]);
  });

  it("minHits sağlayan paragrafları yüksek hits → düşük sırayla döndürür", () => {
    const sections = [
      sec("A",
        "Bu paragraf etkinlik etkinlik etkinlik kelimesini birçok defa tekrar eder " +
        "uzunluğu yeterli olsun ve filtre yönetim sözcükleri de bulunsun."),
      sec("B",
        "Bu paragraf yalnızca filtre yönetim çiftini bir kez içerir ama ikisi de " +
        "burada yer alıyor uzun bir metin olarak — hits=2 olmalı tam olarak."),
    ];
    const out = searchParagraphs(sections, "etkinlik filtre yönetim", {
      minHits: 2,
      maxPerSection: 5,
      maxTotal: 10,
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
    if (out.length > 1) {
      expect(out[0]!.hits).toBeGreaterThanOrEqual(out[1]!.hits);
    }
  });

  it("4 karakter altındaki tokenleri sorgudan eler (ve/ile vs.)", () => {
    const sections = [sec("X", "ve ve ve ve ile ile gibi gürültü dolu kısa " +
      "kelimeler ile dolu yeterli uzunluğa sahip bir paragraf.")];
    const out = searchParagraphs(sections, "ve ile bu");
    expect(out).toEqual([]);
  });

  it("60 karakterden kısa veya 2500'den uzun paragrafları atlar", () => {
    const tooShort = "etkinlik filtre"; // < 60
    const tooLong = ("etkinlik filtre ".repeat(200)).slice(0, 2600); // > 2500
    const sections = [sec("S", `${tooShort}\n\n${tooLong}`)];
    const out = searchParagraphs(sections, "etkinlik filtre", { minHits: 2 });
    expect(out).toEqual([]);
  });
});
