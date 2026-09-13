/**
 * Choose a diverse, budget-bounded subset of captured state screenshots
 * to send to vision. We want maximum interaction-type diversity (not 4
 * column sorts in a row, but at most 1-2 of each kind), so the model
 * sees one of every UI behaviour rather than redundant variations.
 *
 * Reduces input-token cost on busy screens (up to ~14 images) while
 * keeping every distinct interaction class represented.
 *
 * TOKEN DİYETİ: Görsel, taze girdinin baskın maliyet kalemidir (CLI'da asla
 * cache'lenmez). Bu yüzden ÇOK-TEKRARLI kategorilerin cap'i düşük tutulur
 * (adım vurgusu görselleri çoğu zaman kendi "sonuç" görselinin near-duplicate'i;
 * modal/sekme cap'leri de yüksekti). Buna karşılık ÖĞE-TİPİ çeşitliliği
 * (dropdown/input/checkbox… her biri 1) KORUNUR — her etkileşim sınıfından
 * en az bir örnek gitsin. Böylece token düşer, kapsam düşmez.
 */

import type { ScreenState } from "../types/screen";

const MAX_PER_CATEGORY: Record<string, number> = {
  // Adım vurgusu (Scribe tarzı "tıklanacak öğe işaretli" görüntüler) —
  // near-duplicate olmaya en yatkın kategori; birkaç örnek yeter.
  adim: 3,
  kayit: 3, // kayıt-sonrası ekranlar (başarı/post-save) — yüksek değer
  uyari: 3, // doğrulama/validation uyarıları
  sonuc: 3, // filtre/arama sonuç ekranları
  dolu: 3,  // dolu-form state'leri — birkaç temsili örnek yeterli
  // Derin keşifte her sekmenin kendi modalları olur → makul cap.
  modal: 4,
  panel: 2,
  // Tab'lar ayrı alt-ekranlardır; her biri kılavuzda kendi başlığını hak eder.
  sekme: 5,
  // ── Öğe-tipi çeşitliliği: her tipten 1 (kapsam çapası — düşürME) ──
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

const TOTAL_MAX = 14;

function categorize(state: ScreenState): string {
  const t = state.triggeredBy.toLowerCase();
  const lbl = state.label.toLowerCase();
  // Submit-sonrası ekranlar — en yüksek değer (kılavuzda "kaydettikten
  // sonra ne olur" anlatımı). triggeredBy/label ile önce sınıflandırılır.
  if (t.includes("adım vurgusu") || lbl.startsWith("adım:")) return "adim";
  if (t.includes("gerçek submit") || lbl.includes("kayıt sonrası")) return "kayit";
  if (t.includes("doğrulama") || lbl.includes("doğrulama uyarısı")) return "uyari";
  if (lbl.includes("sonuç") || lbl.includes("sonuc") || t.includes("sonuç listesi") || t.includes("okuma submit")) return "sonuc";
  // Dolu-form state'leri (test verisiyle doldurulmuş) — adım-adım veri
  // girişi kılavuzunun temeli; yüksek öncelikli ayrı kategori.
  if (t.includes("dolduruldu") || lbl.includes("(dolu)") || lbl.includes("form dolu")) return "dolu";
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
