import { describe, it, expect } from "vitest";
import {
  computeReferencedScreenshots,
  extractEmbeddedScreenshots,
} from "../src/quality/screenshotRefs";

describe("extractEmbeddedScreenshots", () => {
  it("markdown'dan /screenshots/*.png referanslarını çıkarır", () => {
    const md = "Giriş ![Ana](/screenshots/ekran.png) ve ![Modal](/screenshots/ekran_btn_3.png).";
    expect(extractEmbeddedScreenshots(md)).toEqual(["ekran.png", "ekran_btn_3.png"]);
  });

  it("referans yoksa boş döner", () => {
    expect(extractEmbeddedScreenshots("hiç görsel yok")).toEqual([]);
  });
});

describe("computeReferencedScreenshots", () => {
  const screen = {
    path: "/ekran",
    screenshotPath: "/abs/data/screenshots/ekran.png",
    states: [
      { screenshotPath: "/abs/data/screenshots/ekran_btn_1.png" },
      { screenshotPath: "/abs/data/screenshots/ekran_btn_2.png" },
      { screenshotPath: "/abs/data/screenshots/ekran_btn_3.png" },
    ],
  };

  it("dokümante EDİLMEMİŞ ekranın tüm state'lerini korur (sonra üretilebilir)", () => {
    const ref = computeReferencedScreenshots([screen], []);
    expect(ref.has("ekran.png")).toBe(true);
    expect(ref.has("ekran_btn_1.png")).toBe(true);
    expect(ref.has("ekran_btn_3.png")).toBe(true);
    expect(ref.size).toBe(4);
  });

  it("dokümante EDİLMİŞ ekranda yalnız gömülü + küçük-resmi korur, fazlasını siler", () => {
    const docs = [
      {
        screenPath: "/ekran",
        screenshotPath: "/abs/data/screenshots/ekran.png",
        userManualContent: "![Ana](/screenshots/ekran.png) ![M](/screenshots/ekran_btn_1.png)",
        technicalDocContent: "Teknik: ![M2](/screenshots/ekran_btn_2.png)",
      },
    ];
    const ref = computeReferencedScreenshots([screen], docs);
    // ekran.png + btn_1 (UM) + btn_2 (TD) korunur; btn_3 gömülü DEĞİL → silinebilir
    expect(ref.has("ekran.png")).toBe(true);
    expect(ref.has("ekran_btn_1.png")).toBe(true);
    expect(ref.has("ekran_btn_2.png")).toBe(true);
    expect(ref.has("ekran_btn_3.png")).toBe(false);
  });

  it("ana küçük-resim dokümante edilmiş ekranda bile korunur", () => {
    const docs = [{ screenPath: "/ekran", userManualContent: "boş", technicalDocContent: "boş" }];
    const ref = computeReferencedScreenshots([screen], docs);
    expect(ref.has("ekran.png")).toBe(true); // keşif listesi küçük-resmi
    expect(ref.has("ekran_btn_1.png")).toBe(false); // gömülü değil → silinebilir
  });
});
