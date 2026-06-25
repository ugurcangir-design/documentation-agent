import { describe, it, expect } from "vitest";
import { groupStatesByTab } from "../src/generator/tabGrouping";
import type { ScreenState } from "../src/types/screen";

function st(label: string, file: string): ScreenState {
  return { label, triggeredBy: "x", screenshotPath: `/data/screenshots/${file}`, screenshotBase64: "" };
}

describe("groupStatesByTab", () => {
  it("sekme-dışı state'leri baseStates'e koyar", () => {
    const g = groupStatesByTab([st("Filtre paneli açık", "ekran_filters_open.png"), st("Modal: Ekle", "ekran_btn_1.png")]);
    expect(g.tabs).toHaveLength(0);
    expect(g.baseStates).toHaveLength(2);
  });

  it("_tab_<i> desenine göre gruplar ve sekme adını 'Sekme: X'ten alır", () => {
    const states = [
      st("Sekme: Genel", "ekran_tab_0.png"),
      st("Modal (dolu): Ekle", "ekran_tab_0_btn_2_filled.png"),
      st("Sekme: Gelişmiş", "ekran_tab_1.png"),
      st("Modal: Düzenle", "ekran_tab_1_btn_3.png"),
      st("Filtre paneli açık", "ekran_filters_open.png"),
    ];
    const g = groupStatesByTab(states);
    expect(g.baseStates).toHaveLength(1);
    expect(g.tabs).toHaveLength(2);
    expect(g.tabs[0]).toMatchObject({ index: 0, label: "Genel" });
    expect(g.tabs[0]!.states).toHaveLength(2);
    expect(g.tabs[1]).toMatchObject({ index: 1, label: "Gelişmiş" });
    expect(g.tabs[1]!.states).toHaveLength(2);
  });

  it("sekme grupları indeks sırasına göre sıralanır", () => {
    const states = [
      st("Sekme: B", "x_tab_2.png"),
      st("Sekme: A", "x_tab_0.png"),
      st("Sekme: C", "x_tab_1.png"),
    ];
    const g = groupStatesByTab(states);
    expect(g.tabs.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(g.tabs.map((t) => t.label)).toEqual(["A", "C", "B"]);
  });

  it("adı çözülemeyen sekme için varsayılan etiket", () => {
    const g = groupStatesByTab([st("Modal: X", "x_tab_3_btn_1.png")]);
    expect(g.tabs[0]).toMatchObject({ index: 3, label: "Sekme 4" });
  });
});
