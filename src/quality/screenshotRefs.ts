/**
 * "Kullanılan" ekran görüntülerinin (basename) kümesini hesaplar — bakım
 * temizliği bu kümenin DIŞINDAKİ PNG'leri siler.
 *
 * Bir görüntü KULLANILIYOR sayılır eğer:
 *   1. Bir dokümanın markdown gövdesine gömülüyse (`/screenshots/<ad>.png`)
 *      — üretilmiş kılavuzu/teknik dokümanı render etmek için gerekir.
 *   2. Bir ekranın veya dokümanın birincil küçük-resmi (`screenshotPath`) ise
 *      — keşif listesi / doküman başlığı için gerekir.
 *   3. Henüz DOKÜMANTE EDİLMEMİŞ bir ekrana aitse (o screenPath için hiç
 *      doküman yok) — kullanıcı sonradan üretebilir, state görselleri lazım.
 *
 * Sonuç: dokümante edilmiş ekranların kılavuza GİRMEYEN fazla state
 * görüntüleri "kullanılmıyor" olur ve temizlenebilir. (Re-generation
 * screenStore'daki base64'ten beslendiği için PNG silmek onu bozmaz.)
 */

export interface ScreenLike {
  path: string;
  screenshotPath?: string;
  states?: Array<{ screenshotPath?: string }>;
}

export interface DocumentLike {
  screenPath: string;
  screenshotPath?: string;
  userManualContent?: string;
  technicalDocContent?: string;
}

/** Markdown gövdesinden `/screenshots/<ad>.png` referanslarını çıkarır. */
export function extractEmbeddedScreenshots(markdown: string): string[] {
  const out: string[] = [];
  const re = /\/screenshots\/([A-Za-z0-9_.\-]+\.png)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function baseName(p: string): string {
  // Hem POSIX hem Windows ayıracını destekle (saf — path modülüne bağlı değil).
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

/**
 * Korunması gereken (kullanılan) görüntü basename kümesini döndürür.
 */
export function computeReferencedScreenshots(
  screens: ScreenLike[],
  documents: DocumentLike[]
): Set<string> {
  const referenced = new Set<string>();

  // 1 + 2 (doküman tarafı): gömülü görseller + doküman küçük-resmi
  const documentedScreenPaths = new Set<string>();
  for (const d of documents) {
    documentedScreenPaths.add(d.screenPath);
    if (d.screenshotPath) referenced.add(baseName(d.screenshotPath));
    for (const md of [d.userManualContent, d.technicalDocContent]) {
      if (!md) continue;
      for (const name of extractEmbeddedScreenshots(md)) referenced.add(name);
    }
  }

  // 2 + 3 (ekran tarafı): ana küçük-resim her zaman korunur; state'ler
  // yalnız ekran henüz dokümante edilmemişse korunur.
  for (const s of screens) {
    if (s.screenshotPath) referenced.add(baseName(s.screenshotPath));
    if (!documentedScreenPaths.has(s.path)) {
      for (const st of s.states ?? []) {
        if (st.screenshotPath) referenced.add(baseName(st.screenshotPath));
      }
    }
  }

  return referenced;
}
