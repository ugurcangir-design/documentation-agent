/**
 * Keşif state'lerini sekmeye göre gruplar. Sekme-içi derin keşifte yakalanan
 * state'lerin screenshot dosya adı `..._tab_<i>_...` desenini taşır (örn.
 * `ekran_tab_2_btn_3_filled.png`). Bu desenden sekme indeksi çıkarılır.
 *
 * Amaç: çok sekmeli ekranlarda her sekme için AYRI üretim çağrısı yapıp
 * kılavuzda birleştirmek → hiçbir sekme/işlem kaybolmasın.
 */

import type { ScreenState } from "../types/screen";

export interface TabGroup {
  index: number;
  label: string;
  states: ScreenState[];
}

export interface GroupedStates {
  /** Sekmeye ait olmayan (ekran geneli) state'ler. */
  baseStates: ScreenState[];
  /** Sekme indeksine göre sıralı sekme grupları. */
  tabs: TabGroup[];
}

function baseName(p: string): string {
  const parts = (p || "").split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

/** "Sekme: X" / 'Sekme: "X"' etiketinden sekme adını çıkarır. */
function tabLabelFromState(s: ScreenState): string | null {
  const m = /^Sekme:\s*"?([^"]+?)"?\s*$/.exec(s.label.trim());
  return m && m[1] ? m[1].trim() : null;
}

export function groupStatesByTab(states: ScreenState[]): GroupedStates {
  const baseStates: ScreenState[] = [];
  const tabMap = new Map<number, TabGroup>();

  for (const s of states) {
    const m = /_tab_(\d+)/.exec(baseName(s.screenshotPath));
    if (!m) {
      baseStates.push(s);
      continue;
    }
    const idx = parseInt(m[1] as string, 10);
    let g = tabMap.get(idx);
    if (!g) {
      g = { index: idx, label: `Sekme ${idx + 1}`, states: [] };
      tabMap.set(idx, g);
    }
    g.states.push(s);
    // Sekmenin kendi görseli (label "Sekme: X") gerçek adı verir.
    const lbl = tabLabelFromState(s);
    if (lbl) g.label = lbl;
  }

  const tabs = [...tabMap.values()].sort((a, b) => a.index - b.index);
  return { baseStates, tabs };
}
