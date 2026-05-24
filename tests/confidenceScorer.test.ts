import { describe, it, expect } from "vitest";
import { tokenize, buildTokenRegex, calculateConfidenceScore } from "../src/quality/confidenceScorer";

describe("tokenize", () => {
  it("Sadece dilbilgisel dolgu kelimelerini eler — 'kullanıcı/ekran/sayfa' artık token'dır", () => {
    const out = tokenize("Kullanıcı yönetimi ekranı için ve şu");
    expect(out).toContain("kullanıcı");
    expect(out).toContain("yönetimi");
    expect(out).toContain("ekranı");
    expect(out).not.toContain("için");
    expect(out).not.toContain("şu");
    expect(out).not.toContain("ve");
  });

  it("3 karakter altındaki token'ları eler", () => {
    expect(tokenize("a bc xy")).toEqual([]);
  });

  it("Türkçe karakterleri ve büyük harfleri normalize eder", () => {
    expect(tokenize("Filtreleme Çubuğu")).toEqual(["filtreleme", "çubuğu"]);
  });
});

describe("buildTokenRegex (Türkçe suffix toleransı)", () => {
  it("Token'ın suffix'siz halini yakalar", () => {
    expect("filtre".match(buildTokenRegex("filtre"))?.length).toBe(1);
  });

  it("Yaygın Türkçe çekim eklerini yakalar (-ler/-leri/-nin/-dan/-lerin)", () => {
    const text = "filtreler filtreyi filtreden filtrelerin";
    const m = text.match(buildTokenRegex("filtre"));
    expect(m?.length).toBe(4);
  });

  it("Çok uzun suffix chain'lerini (>8 char) yakalamaz — agresif over-match önlenir", () => {
    expect("filtreabcdefghijklmno".match(buildTokenRegex("filtre"))).toBeNull();
  });

  it("Kelime sınırı korunur — 'arifiltre' gibi ön-bitişikler eşleşmez", () => {
    expect("arifiltre".match(buildTokenRegex("filtre"))).toBeNull();
  });
});

describe("calculateConfidenceScore (suffix toleransıyla)", () => {
  it("Çekim ekli kelime varlığında da skor üretir", () => {
    const s = calculateConfidenceScore(
      "Etkinlik Yönetimi",
      "Bu bölüm etkinlikleri yönetmek için kullanılır. Etkinliği oluşturma ve düzenleme.",
      "etkinlik yönetim"
    );
    expect(s).toBeGreaterThan(0);
  });
});
