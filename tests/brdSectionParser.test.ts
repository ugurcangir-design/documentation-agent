import { describe, it, expect } from "vitest";
import { parseBrdSections } from "../src/retrieval/brdSectionParser";

describe("parseBrdSections", () => {
  it("Markdown başlıklarına göre bölümleri ayırır ve boşları atar", () => {
    const md = `# Giriş\nAna metin.\n\n## Detay\nİkinci bölüm.\n\n## Boş\n`;
    const out = parseBrdSections(md, "brd.md");
    expect(out.map((s) => s.title)).toEqual(["Giriş", "Detay"]);
    expect(out[0]?.content).toContain("Ana metin");
    expect(out[1]?.content).toContain("İkinci bölüm");
  });

  it("Her bölümün sourceType 'brd' ve stable id'si olur", () => {
    const out = parseBrdSections("# A\nx", "brd.md");
    expect(out[0]?.sourceType).toBe("brd");
    expect(out[0]?.id).toBe("brd.md-A");
    expect(out[0]?.sourceId).toBe("brd.md");
  });

  it("Başlıksız markdown'da Introduction bölümüne düşer", () => {
    const out = parseBrdSections("sadece düz metin", "x.md");
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe("Introduction");
  });
});
