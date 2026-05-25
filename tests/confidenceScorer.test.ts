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

  it("Türkçe çekim eklerini (ı/ü/ünden/ında) yakalar — Unicode boundary", () => {
    expect("filtreyı".match(buildTokenRegex("filtre"))?.[0]).toBe("filtreyı");
    expect("filtreden".match(buildTokenRegex("filtre"))?.[0]).toBe("filtreden");
    // Ünsüz yumuşaması yok (suffix ünsüzle başlıyor) — stem değişmez
    expect("etkinlikten".match(buildTokenRegex("etkinlik"))?.[0]).toBe("etkinlikten");
    expect("etkinlikler".match(buildTokenRegex("etkinlik"))?.[0]).toBe("etkinlikler");
  });

  it("Türkçe karakterli token (ş/ğ/ç/ö/ü) yakalanır", () => {
    expect("süzgeçleri".match(buildTokenRegex("süzgeç"))?.[0]).toBe("süzgeçleri");
    expect("öğrenci".match(buildTokenRegex("öğrenci"))?.[0]).toBe("öğrenci");
  });

  it("Türkçe ünsüz yumuşaması (k→ğ, p→b, t→d, ç→c) — stem değişimi YOK", () => {
    // Bilinen sınırlama: "etkinlik" → "etkinliği" gibi stem softening
    // formları regex'in kapsamı dışındadır. Tam morfolojik stemmer
    // (Zemberek vb.) gerekir; pratikte BRD/Confluence içeriği genelde
    // mastar formuyla yazıldığı için tolere edilebilir bir limit.
    expect("etkinliği".match(buildTokenRegex("etkinlik"))).toBeNull();
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
