import { describe, it, expect } from "vitest";
import { parseFlatTextSections, parseDocumentSections } from "../src/retrieval/flatTextSectionParser";

describe("parseFlatTextSections", () => {
  it("Numbered outline heading'leri (1., 1.1., 1.1.1.) bölüm sınırı olarak tanır", () => {
    const txt = [
      "1. Prematch Program",
      "Bu bölüm hakkında giriş paragrafı yeterince uzun olsun ki body kabul edilsin.",
      "",
      "1.1. Prematch Event List",
      "Event listesi davranış açıklaması burada yer alır ve birkaç cümle içerir.",
      "",
      "1.1.1. Event Detail",
      "Detay ekranının iş kuralları bu bölümde açıklanır.",
    ].join("\n");
    const out = parseFlatTextSections(txt, "doc.txt");
    expect(out.map((s) => s.title)).toEqual([
      "1. Prematch Program",
      "1.1. Prematch Event List",
      "1.1.1. Event Detail",
    ]);
  });

  it("Standalone ALL-CAPS heading'leri (AMAÇ, GEREKSİNİMLER) tanır", () => {
    const txt = [
      "AMAÇ",
      "Bu modülün amacı kullanıcı yönetimi sürecini otomatikleştirmektir; uzun açıklama.",
      "",
      "GEREKSİNİMLER",
      "İlk gereksinim authentication ile başlar, ikinci gereksinim role-based access.",
    ].join("\n");
    const out = parseFlatTextSections(txt, "doc.txt");
    expect(out.map((s) => s.title)).toEqual(["AMAÇ", "GEREKSİNİMLER"]);
  });

  it("Hiç heading yoksa tek 'Introduction' bölümü üretir (geriye dönük uyum)", () => {
    const txt = "Düz metin paragrafı. Hiçbir heading yok. Birkaç cümle daha.";
    const out = parseFlatTextSections(txt, "flat.txt");
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Introduction");
  });

  it("sourceType parametresi (varsayılan 'brd', 'process_analysis' verilebilir)", () => {
    const txt = "AMAÇ\nBu bölümün amacı süreci tanımlamaktır ve detaylı bir paragraftır.";
    const brd = parseFlatTextSections(txt, "d.txt");
    expect(brd[0]?.sourceType).toBe("brd");
    const pa = parseFlatTextSections(txt, "d.txt", "process_analysis");
    expect(pa[0]?.sourceType).toBe("process_analysis");
  });

  it("Cümle ortası gibi görünen satırlar (noktalama ile biten) heading sayılmaz", () => {
    const txt = [
      "Bu bir cümledir ve heading değildir.",
      "Asıl içerik burada yer alır ve birkaç paragraf uzunluğunda devam eder.",
    ].join("\n");
    const out = parseFlatTextSections(txt, "doc.txt");
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Introduction");
  });
});

describe("parseDocumentSections (dispatcher)", () => {
  it("Markdown # heading varsa markdown parser'a yönlendirir", () => {
    const md = "# Başlık\nİçerik paragrafı yeterince uzun olsun ki kabul edilsin.";
    const out = parseDocumentSections(md, "doc.md");
    expect(out[0]?.title).toBe("Başlık");
    expect(out[0]?.sourceType).toBe("brd");
  });

  it("Markdown parser yolu, sourceType override edilebilir (process_analysis)", () => {
    const md = "# Süreç\nDetaylı bir süreç açıklaması yer alır burada.";
    const out = parseDocumentSections(md, "p.md", "process_analysis");
    expect(out[0]?.sourceType).toBe("process_analysis");
  });

  it("Markdown yoksa flat-text parser'a düşer", () => {
    const flat = "AMAÇ\nBu bölümün amacı süreci tanımlamaktır ve detaylı bir paragraftır.";
    const out = parseDocumentSections(flat, "flat.txt", "process_analysis");
    expect(out[0]?.title).toBe("AMAÇ");
    expect(out[0]?.sourceType).toBe("process_analysis");
  });
});
