import { describe, it, expect } from "vitest";
import { selectRepresentativeStates } from "../src/generator/selectStates";
import type { ScreenState } from "../src/types/screen";

function st(label: string, triggeredBy: string): ScreenState {
  return { label, triggeredBy, screenshotPath: `/tmp/${label}.png`, screenshotBase64: "" };
}

describe("selectRepresentativeStates", () => {
  it("eşik altındaki state'leri olduğu gibi döndürür", () => {
    const states = [st("Sekme: A", "tab a"), st("Modal: B", "buton")];
    expect(selectRepresentativeStates(states)).toHaveLength(2);
  });

  it("dolu-form state'lerini eleme sırasında korur (headline özellik)", () => {
    const states: ScreenState[] = [];
    // 14 adet sıralama state'i (cap 1) → eleme tetiklenir
    for (let i = 0; i < 14; i++) states.push(st(`Sıralama: kol${i}`, `kolon header tıklandı: kol${i}`));
    // 3 dolu-form state'i ekle
    states.push(st("Modal (dolu): Yeni Kayıt", "Modal test verisiyle dolduruldu (5 alan)"));
    states.push(st("Form dolu (ana ekran)", "ana ekran formu test verisiyle dolduruldu"));
    states.push(st("Modal (dolu): Düzenle", "düzenleme modalı test verisiyle dolduruldu (3 alan)"));

    const picked = selectRepresentativeStates(states);
    const filled = picked.filter(
      (s) => s.label.toLowerCase().includes("dolu") || s.triggeredBy.includes("dolduruldu")
    );
    // 'dolu' kategorisi cap 4 → en az 3 dolu state hayatta kalmalı
    expect(filled.length).toBeGreaterThanOrEqual(3);
  });

  it("submit-sonrası ekranları (kayıt/uyarı/sonuç) eleme sırasında korur", () => {
    const states: ScreenState[] = [];
    for (let i = 0; i < 16; i++) states.push(st(`Sıralama: kol${i}`, `kolon header tıklandı: kol${i}`));
    states.push(st("Kayıt sonrası: Yeni", "form gönderildi (Kaydet) — GERÇEK submit"));
    states.push(st("Form doğrulama uyarısı (ana ekran)", "zorunlu/geçersiz alan blur — istemci doğrulaması"));
    states.push(st("Filtre/arama sonucu", "okuma submit tıklandı (Ara) — sonuç listesi"));

    const picked = selectRepresentativeStates(states);
    expect(picked.some((s) => s.label.includes("Kayıt sonrası"))).toBe(true);
    expect(picked.some((s) => s.label.includes("doğrulama uyarısı"))).toBe(true);
    expect(picked.some((s) => s.label.includes("Filtre/arama sonucu"))).toBe(true);
  });
});
