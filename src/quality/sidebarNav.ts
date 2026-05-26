/**
 * Global sidebar / top-nav öğelerini tespit eder. Bu öğeler başka ekranlara
 * yönlendiren navigation linkleridir; doküman üretiminde **ele alınmamalı**
 * çünkü o ekranın değil sayfa şablonunun parçasıdır.
 *
 * Birincil kaynak: `analyzeScreen` (LLM) her UI öğesine `isGlobalNav:
 * boolean` ataması yapar. LLM ekranı görüp karar verdiği için hedef
 * uygulamadan bağımsızdır.
 *
 * Yedek: aşağıdaki hint listesi YALNIZCA eski/cached analiz çıktılarında
 * `isGlobalNav` alanı yoksa devreye girer (geriye dönük uyumluluk). Yeni
 * üretilen analizler hint'e ihtiyaç duymaz; bu liste önce sports betting
 * / Analyst Studio için kalmıştı, zamanla cache yenilendikçe sadece
 * fallback olarak kalır. Cache invalidate edilirse liste tamamen
 * gereksizleşir; çıkartmadan önce ekipçe regression doğrula.
 */
export const SIDEBAR_NAV_HINTS: readonly string[] = [
  "sport base data", "sports", "categories", "competitions", "market setup",
  "priority settings", "venues", "competitors", "heroes", "multi feed",
  "sport mapping", "market mapping", "definitions", "event management",
  "outright program", "live program", "newspaper program", "v-sport program",
  "exported program", "groups", "outright",
  "settings", "ürünler", "users", "logout", "çıkış",
];

export interface SidebarNavLike {
  label: string;
  type: string;
  /** screenAnalyzer (LLM) bu öğeyi global nav olarak işaretlediyse true.
   *  Tanımlıysa kararı bu alan verir; tanımlı değilse hardcoded hint
   *  listesine fallback. */
  isGlobalNav?: boolean;
}

export function isSidebarNav(el: SidebarNavLike): boolean {
  // LLM kararı varsa onu kullan (hedef uygulamadan bağımsız, kesin).
  if (typeof el.isGlobalNav === "boolean") return el.isGlobalNav;
  // Eski/cached analizler için hardcoded hint fallback.
  if (el.type === "menu") return true;
  const lbl = el.label.toLowerCase().trim();
  return SIDEBAR_NAV_HINTS.some((h) => lbl === h || lbl.startsWith(h + " "));
}
