/**
 * Markdown heading'i (`#`) olmayan flat text doküman'lar için bölüm
 * ayrıştırıcı. `mammoth` (.docx) ve `pdf-parse` (.pdf) çıktıları
 * heading hiyerarşisini yalnızca **görsel** olarak tutar (numbered
 * outline veya ALL-CAPS standalone satırlar); `parseBrdSections` bu
 * yapıyı göremediği için tüm doküman tek "Introduction" bölümü
 * oluyordu → 76 sayfa içerik tek bloba sıkışıyordu → retrieval
 * bütçesi/dengelemesi bozuluyordu.
 *
 * Bu modül iki paterni heading olarak tanır:
 *   1. **Numbered outline:** "1.", "1.1.", "1.2.3. Bölüm Adı"
 *   2. **Standalone uppercase:** "AMAÇ", "GEREKSİNİMLER", "KAPSAM"
 *
 * Her ikisi de:
 *   - ≤ 100 char
 *   - Cümle bitiş noktalama'sı (`.`/`,`/`:`/`;`) ile bitmez
 *   - Tek bir satırda
 */

import type { DocumentSection, DocumentSourceType } from "../types/documentSource";
import { parseBrdSections } from "./brdSectionParser";

const NUMBERED_HEADING = /^\s*\d+(?:\.\d+)*\.?\s+\S/;
// Tek-satır ALL-CAPS başlık (Türkçe + İngilizce harf seti). Min 3 char,
// max 40. Karışık küçük harf yoksa heading sayılır.
const UPPERCASE_HEADING = /^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9\s&\-/().]{2,39}$/;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 100) return false;
  // Cümle ortası gibi görünüyor (noktalama) → heading değil
  if (/[.,:;](?:\s.*)?$/.test(t)) {
    // Numbered heading'lerde `1.1.` gibi nokta var; özel istisna:
    // numbered pattern eşleşiyorsa noktalama testini atla.
    if (!NUMBERED_HEADING.test(t)) return false;
  }
  if (NUMBERED_HEADING.test(t)) return true;
  if (t.length <= 40 && UPPERCASE_HEADING.test(t)) return true;
  return false;
}

/**
 * Flat text content'i heading sezgisiyle bölümlere ayır. Heading
 * tespit edemezse tek "Introduction" bölümü döndürür (geriye dönük
 * uyumluluk; eski davranış).
 *
 * @param sourceType — Yüklenen referans tipi: BRD ise "brd", proses
 *   analizi / süreç doc'u ise "process_analysis". sourcePriority bu
 *   etikete göre ağırlık verir.
 */
export function parseFlatTextSections(
  content: string,
  sourceFile: string,
  sourceType: DocumentSourceType = "brd"
): DocumentSection[] {
  const lines = content.split("\n");
  const sections: DocumentSection[] = [];

  let currentTitle = "Introduction";
  let currentBody: string[] = [];

  const push = () => {
    const body = currentBody.join("\n").trim();
    if (body.length > 0) {
      sections.push({
        id: `${sourceFile}-${currentTitle}`,
        sourceId: sourceFile,
        sourceType,
        sourceFile,
        title: currentTitle,
        content: body,
      });
    }
  };

  for (const line of lines) {
    if (isHeading(line)) {
      push();
      currentTitle = line.trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  push();

  return sections;
}

/**
 * Dispatcher: markdown heading varsa `parseBrdSections`'a yönlendir,
 * yoksa `parseFlatTextSections` ile sezgisel parse yap.
 *
 * `parseBrdSections` her zaman `sourceType: "brd"` üretir; flat-text
 * yolu çağırana tip seçimi bırakır (yüklenen reference doc'lar
 * `process_analysis` olarak etiketlenir).
 */
export function parseDocumentSections(
  content: string,
  sourceFile: string,
  sourceType: DocumentSourceType = "brd"
): DocumentSection[] {
  // Markdown sezimi: en az bir başlık satırı `# ` / `## ` / `### ` …
  if (/^#{1,6}\s/m.test(content)) {
    // parseBrdSections sourceType'ı zorla 'brd' yapar; çağıran reference
    // tipi doc'u markdown formatında verirse sourceType override'ı
    // uygulayalım (markdown'ı brd dışında etiketlemek nadir ama geçerli).
    const out = parseBrdSections(content, sourceFile);
    if (sourceType !== "brd") {
      for (const s of out) s.sourceType = sourceType;
    }
    return out;
  }
  return parseFlatTextSections(content, sourceFile, sourceType);
}
