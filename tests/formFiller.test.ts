import { describe, it, expect } from "vitest";
import { sampleValueForField, classifySubmitButton } from "../src/browser/formFiller";

const NOW = new Date("2026-06-24T08:00:00Z");

describe("sampleValueForField — tür önceliği", () => {
  it("parola ve file alanlarını doldurmaz (null)", () => {
    expect(sampleValueForField({ type: "password" })).toBeNull();
    expect(sampleValueForField({ type: "file" })).toBeNull();
  });

  it("e-posta / tel / url / number türlerini doğru üretir", () => {
    expect(sampleValueForField({ type: "email" })).toBe("test@ornek.com");
    expect(sampleValueForField({ type: "tel" })).toMatch(/^\d{10}$/);
    expect(sampleValueForField({ type: "url" })).toMatch(/^https?:\/\//);
    expect(sampleValueForField({ type: "number" })).toBe("42");
  });

  it("tarih türlerini ISO formatında üretir", () => {
    expect(sampleValueForField({ type: "date" }, NOW)).toBe("2026-06-24");
    expect(sampleValueForField({ type: "datetime-local" }, NOW)).toBe("2026-06-24T10:00");
    expect(sampleValueForField({ type: "month" }, NOW)).toBe("2026-06");
    expect(sampleValueForField({ type: "week" }, NOW)).toMatch(/^2026-W\d{2}$/);
    expect(sampleValueForField({ type: "time" }, NOW)).toBe("10:00");
  });
});

describe("sampleValueForField — serbest metinde bağlam sezgisi", () => {
  it("alan adı/etiketten anlamlı değer seçer", () => {
    expect(sampleValueForField({ type: "text", label: "E-posta adresi" })).toBe("test@ornek.com");
    expect(sampleValueForField({ type: "text", name: "telefon" })).toMatch(/^\d{10}$/);
    expect(sampleValueForField({ type: "text", placeholder: "Açıklama giriniz" })).toContain("açıklama");
    expect(sampleValueForField({ type: "text", label: "Tutar" })).toBe("100");
    expect(sampleValueForField({ type: "text", label: "Adres" })).toContain("Mah.");
    expect(sampleValueForField({ type: "text", label: "Ürün Kodu" })).toBe("ORN-123");
  });

  it("Türkçe büyük/küçük harf (İ/ı) duyarlı eşleşir", () => {
    // 'İSİM' büyük harf — toLocaleLowerCase('tr') ile 'isim' olmalı
    expect(sampleValueForField({ type: "text", label: "İSİM" })).toBe("Örnek Ad");
  });

  it("tanınmayan alanlarda güvenli varsayılan döner", () => {
    expect(sampleValueForField({ type: "text", label: "xyzqwerty" })).toBe("Örnek Veri");
    expect(sampleValueForField({ type: "text" })).toBe("Örnek Veri");
  });
});

describe("classifySubmitButton", () => {
  it("okuma (mutasyonsuz) butonlarını ayırır", () => {
    for (const l of ["Ara", "Filtrele", "Filtre Uygula", "Listele", "Getir", "Göster", "Search", "Apply"]) {
      expect(classifySubmitButton(l)).toBe("read");
    }
  });

  it("yazma (mutasyon) butonlarını ayırır", () => {
    for (const l of ["Kaydet", "Gönder", "Oluştur", "Güncelle", "Onayla", "Save", "Submit", "Create"]) {
      expect(classifySubmitButton(l)).toBe("write");
    }
  });

  it("yıkıcı butonları 'destructive' işaretler (asla tıklanmaz)", () => {
    expect(classifySubmitButton("Sil")).toBe("destructive");
    expect(classifySubmitButton("Kaydı Sil")).toBe("destructive");
    expect(classifySubmitButton("Delete")).toBe("destructive");
  });

  it("okuma yazmadan önceliklidir ('Filtre Uygula' → read)", () => {
    expect(classifySubmitButton("Filtre Uygula")).toBe("read");
  });

  it("ilgisiz/boş etiketlerde 'none' döner", () => {
    expect(classifySubmitButton("İptal")).toBe("none");
    expect(classifySubmitButton("Kapat")).toBe("none");
    expect(classifySubmitButton("")).toBe("none");
  });
});
