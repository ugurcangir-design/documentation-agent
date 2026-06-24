import { describe, it, expect } from "vitest";
import { buildScreenshotEmbedBlock, type StateImageRef } from "../src/generator/userManualGenerator";

const states: StateImageRef[] = [
  { n: 2, label: "Modal: Ekle", triggeredBy: "buton tıklandı: Ekle", url: "/screenshots/x_btn_1.png" },
  { n: 3, label: "Filtre paneli açık", triggeredBy: "Filtre tıklandı", url: "/screenshots/x_filters.png" },
];

describe("buildScreenshotEmbedBlock", () => {
  // REGRESYON: state'i olmayan ekranda eskiden blok komple düşüyordu →
  // model ana ekran görselini bile embed etmiyordu (embed:0, görüntüsüz kılavuz).
  it("state YOKKEN bile ana ekran embed'ini ve zorunluluk talimatını içerir", () => {
    const block = buildScreenshotEmbedBlock("/screenshots/ana.png", [], "/risk-management/risk-categories");
    expect(block).not.toBe("");
    expect(block).toContain("![Ana ekran](/screenshots/ana.png)");
    expect(block).toMatch(/EKRAN GÖRÜNTÜSÜ OLMADAN KILAVUZ YAZMA/);
    expect(block).toMatch(/En az 1 embed/);
    expect(block).toContain("# 1 GÖRSEL VERİLDİ");
  });

  it("state varken ana + tüm state görsellerini listeler", () => {
    const block = buildScreenshotEmbedBlock("/screenshots/ana.png", states, "/ekran");
    expect(block).toContain("![Ana ekran](/screenshots/ana.png)");
    expect(block).toContain("/screenshots/x_btn_1.png");
    expect(block).toContain("/screenshots/x_filters.png");
    expect(block).toContain("# 3 GÖRSEL VERİLDİ");
    expect(block).toMatch(/En az 3 embed/);
  });

  it("ana görsel yoksa yalnız state'leri kullanır; hiç görsel yoksa boş döner", () => {
    expect(buildScreenshotEmbedBlock(null, [], "/ekran")).toBe("");
    const onlyStates = buildScreenshotEmbedBlock(null, states, "/ekran");
    expect(onlyStates).toContain("/screenshots/x_btn_1.png");
    expect(onlyStates).not.toContain("Ana ekran](");
  });

  it("embed üst sınırı 12'dir", () => {
    const many: StateImageRef[] = Array.from({ length: 20 }, (_, i) => ({
      n: i + 2, label: `s${i}`, triggeredBy: "t", url: `/screenshots/s${i}.png`,
    }));
    const block = buildScreenshotEmbedBlock("/screenshots/ana.png", many, "/ekran");
    expect(block).toMatch(/En az 12 embed/);
  });
});
