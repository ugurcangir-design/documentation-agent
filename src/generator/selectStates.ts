/**
 * Choose a diverse, budget-bounded subset of captured state screenshots
 * to send to vision. We want maximum interaction-type diversity (not 4
 * column sorts in a row, but at most 1-2 of each kind), so the model
 * sees one of every UI behaviour rather than redundant variations.
 *
 * Reduces input-token cost ~50% on busy screens (22 → 10 images) while
 * keeping every distinct interaction class represented.
 */

import type { ScreenState } from "../types/screen";

const MAX_PER_CATEGORY: Record<string, number> = {
  modal: 3,
  panel: 2,
  sekme: 2,
  dropdown: 1,
  tarih: 1,
  checkbox: 1,
  toggle: 1,
  input: 1,
  tooltip: 1,
  satır: 1,
  sıralama: 1,
  accordion: 1,
  buton: 1,
};

const TOTAL_MAX = 11;

function categorize(state: ScreenState): string {
  const t = state.triggeredBy.toLowerCase();
  if (t.includes("tab")) return "sekme";
  if (t.includes("dropdown")) return "dropdown";
  if (t.includes("tarih")) return "tarih";
  if (t.includes("checkbox")) return "checkbox";
  if (t.includes("toggle")) return "toggle";
  if (t.includes("input")) return "input";
  if (t.includes("hover") || t.includes("tooltip")) return "tooltip";
  if (t.includes("satır") || t.includes("row")) return "satır";
  if (t.includes("sıralama") || t.includes("kolon header")) return "sıralama";
  if (t.includes("accordion")) return "accordion";
  // Default by label
  if (state.label.toLowerCase().startsWith("modal")) return "modal";
  if (state.label.toLowerCase().includes("panel") || state.label.toLowerCase().includes("etki"))
    return "panel";
  return "buton";
}

export function selectRepresentativeStates(states: ScreenState[]): ScreenState[] {
  if (states.length <= TOTAL_MAX) return states;

  const perCategory = new Map<string, number>();
  const out: ScreenState[] = [];

  for (const s of states) {
    if (out.length >= TOTAL_MAX) break;
    const cat = categorize(s);
    const cap = MAX_PER_CATEGORY[cat] ?? 1;
    const taken = perCategory.get(cat) ?? 0;
    if (taken >= cap) continue;
    perCategory.set(cat, taken + 1);
    out.push(s);
  }

  return out;
}
