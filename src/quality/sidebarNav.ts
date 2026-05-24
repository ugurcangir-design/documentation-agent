/**
 * Global sidebar / top-nav öğelerini tespit eder. Bu öğeler başka ekranlara
 * yönlendiren navigation linkleridir; doküman üretiminde **ele alınmamalı**
 * çünkü o ekranın değil sayfa şablonunun parçasıdır.
 *
 * Liste hedef uygulamaya özgü (sports betting / Analyst Studio). Yeni bir
 * hedef uygulama eklendiğinde bu listenin yeniden ele alınması gerekir;
 * uzun vadede `analyzeScreen` çıktısına `isGlobalNav: boolean` ekleyip
 * LLM'in karar vermesine bırakmak daha doğru olacaktır.
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
}

export function isSidebarNav(el: SidebarNavLike): boolean {
  if (el.type === "menu") return true;
  const lbl = el.label.toLowerCase().trim();
  return SIDEBAR_NAV_HINTS.some((h) => lbl === h || lbl.startsWith(h + " "));
}
