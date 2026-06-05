/**
 * Jira issue status filtresi. Bir Jira projesi referans olarak
 * senkronize edilirken, henüz başlanmamış / iptal edilmiş issue'lar
 * doküman bağlamına alınmamalı — bunlar "kararlaştırılmış / yapılmış
 * iş"i temsil etmez, üretilen kılavuzu yanıltabilir. Yalnızca
 * üzerinde çalışılan / tamamlanan (ve diğer aktif) statüler baz alınır.
 *
 * Hariç tutulan kategoriler (kullanıcı talebi): Backlog, To Do, Cancel.
 * Statü isimleri Jira instance'ına göre değiştiği için isim normalize
 * edilip yaygın TR/EN varyasyonlarıyla eşleştirilir. Yeni bir varyasyon
 * çıkarsa EXCLUDED_STATUSES'a eklenmesi yeterli.
 */

/**
 * Normalize edilmiş hariç-tutma statüleri (lowercase, boşluk sade).
 * Kullanıcı talebi: Backlog, To Do, Cancel. Yalnızca bu üç kategori ve
 * bariz TR/EN dil varyasyonları — "Open", "New", "Rejected" gibi
 * tartışmalı statüler kasıtlı olarak DAHİL bırakıldı (yanlışlıkla
 * geçerli issue elememek için). Yeni varyasyon gerekirse buraya ekleyin.
 */
// NOT: Girişler Türkçe-katlanmış (fold) formda — normalizeStatus ile
// aynı dönüşümden geçmiş halleri. ı/İ→i, ş→s, ğ→g, ç→c, ö→o, ü→u.
export const EXCLUDED_JIRA_STATUSES: ReadonlySet<string> = new Set([
  // Backlog
  "backlog",
  // To Do / yapılacak
  "to do", "todo", "to-do", "yapilacak",
  // Cancel(led) / iptal
  "cancel", "cancelled", "canceled",
  "iptal", "iptal edildi", "vazgecildi",
]);

/**
 * Statü ismini eşleştirme için sadeleştir: Türkçe karakter katlama
 * (fold) + lowercase + tek boşluk. Türkçe `İ`.toLowerCase() combining
 * dot üretip eşleşmeyi bozduğu için karakterler önce ASCII'ye katlanır.
 */
function normalizeStatus(status: string): string {
  return status
    .trim()
    .replace(/[İIı]/g, "i")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Çç]/g, "c")
    .replace(/[Öö]/g, "o")
    .replace(/[Üü]/g, "u")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Bu statüdeki issue bağlama alınmamalı mı? Boş/bilinmeyen statü
 * **dahil edilir** (false) — veri eksikse muhafazakâr davran, atma.
 */
export function isExcludedJiraStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  return EXCLUDED_JIRA_STATUSES.has(normalizeStatus(status));
}
