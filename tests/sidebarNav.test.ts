import { describe, it, expect } from "vitest";
import { isSidebarNav } from "../src/quality/sidebarNav";

describe("isSidebarNav", () => {
  it("LLM kararı (isGlobalNav) varsa o önceliklidir — true", () => {
    expect(isSidebarNav({ type: "button", label: "Kaydet", isGlobalNav: true })).toBe(true);
  });

  it("LLM kararı (isGlobalNav) varsa o önceliklidir — false (hardcoded hint'i bile yener)", () => {
    // 'logout' hint listesinde ama LLM bu ekranda *asıl öğe* dediyse
    // onun kararı geçer (örn. çıkış yapma akışını dokümante eden ekran).
    expect(isSidebarNav({ type: "button", label: "logout", isGlobalNav: false })).toBe(false);
  });

  it("isGlobalNav yoksa hardcoded hint fallback'i çalışır (eski cache uyumu)", () => {
    expect(isSidebarNav({ type: "button", label: "Sport Base Data" })).toBe(true);
  });

  it("'menu' tipi her zaman sidebar nav sayılır", () => {
    expect(isSidebarNav({ type: "menu", label: "rastgele" })).toBe(true);
  });

  it("Bilinen global nav etiketleri (case-insensitive) yakalanır", () => {
    expect(isSidebarNav({ type: "button", label: "Sport Base Data" })).toBe(true);
    expect(isSidebarNav({ type: "button", label: "outright" })).toBe(true);
    expect(isSidebarNav({ type: "button", label: "Çıkış" })).toBe(true);
  });

  it("Boşlukla başlayan eşleşmeleri (ör. 'sports tab') sidebar sayar", () => {
    expect(isSidebarNav({ type: "button", label: "sports tab" })).toBe(true);
  });

  it("Etiketin içine gömülü kelimeyi (ör. 'My Sports Page') sidebar saymaz", () => {
    expect(isSidebarNav({ type: "button", label: "Game Sports Hero" })).toBe(false);
  });

  it("Sıradan UI etiketleri sidebar değildir", () => {
    expect(isSidebarNav({ type: "button", label: "Kaydet" })).toBe(false);
    expect(isSidebarNav({ type: "filter", label: "Tarih" })).toBe(false);
  });
});
