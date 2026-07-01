/**
 * Targeted coverage fix-up. Given an existing document and a list of
 * UI elements that the coverage check found missing, asks Claude to
 * extend the document so those elements are described — without
 * rewriting the rest of the content.
 *
 * Triggered only when coverage falls below a threshold so the
 * additional cost is bounded.
 */

import type { UIElement } from "../types/screen";
import { callClaude, MODEL_QUALITY } from "../llm/claudeClient";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";

export interface FixUpResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  addedCount: number;
}

interface FixUpInput {
  docKind: "userManual" | "technicalDoc";
  currentContent: string;
  missing: string[];               // formatted labels e.g. "Sayfalama (other)"
  uiElementsMissing: UIElement[];  // full analyzer entries for missing items
  screenTitle: string;
}

function buildPrompt(input: FixUpInput): string {
  const role =
    input.docKind === "userManual"
      ? "Sen bir kullanıcı kılavuzu yazarısın. Mevcut kılavuza eksik kalan UI öğelerini akıcı şekilde EKLEYECEKSİN."
      : "Sen bir teknik döküman analistsin. Mevcut teknik dökümana eksik bileşenleri EKLEYECEKSİN.";

  const missingList = input.uiElementsMissing
    .map((el, i) =>
      `${i + 1}. **${el.label}** (${el.type}) — ${el.description}${el.action ? ` → ${el.action}` : ""}`
    )
    .join("\n");

  const placement =
    input.docKind === "userManual"
      ? `Eksik öğeleri uygun bölüm(ler)e yerleştir:
- Filtreleme/arama ile ilgili → 'Filtreler ve Arama Seçenekleri'
- Tablo / satır işlemleri ile ilgili → 'Satır Üzerindeki İşlemler' veya 'Tablo / Liste Görünümü'
- Modal açan butonlar → 'Modallar ve Yan Paneller' altında yeni alt başlık
- Sayfalama, görünüm kontrolleri → mevcut tablo bölümüne sayfalama paragrafı ekle
- Diğer → 'Ekrana İlk Bakış' veya en uygun mevcut bölüm`
      : `Eksik öğeleri uygun spec bölümüne yerleştir: Bileşen Envanteri tablosuna satır, Form/Modal spec'ine sub-section, vb.`;

  return `${role}

# Mevcut Döküman

${input.currentContent}

---

# Eksik UI Öğeleri (kapsam check'inden)

Bu ${input.uiElementsMissing.length} öğeye dökümanda atıf yok. ${input.screenTitle} ekranına aittir, anlatılmalı:

${missingList}

---

# Görev

Yukarıdaki dökümanı **yeniden yaz**, ama:
1. Mevcut tüm bölümleri ve içeriği KORU
2. ${placement}
3. Markdown image tag'lerini DEĞİŞTİRME — mevcut görselleri olduğu yerde bırak
4. Mevcut 'Üretim Bilgisi' footer'ını kaldır (yenisi sonradan eklenecek)
5. Doğal anlatım — envanter tablosu olarak değil, kullanıcı/geliştirici diliyle

Yalnızca güncellenmiş dökümanı döndür (Markdown). Açıklama, önsöz, sonsöz ekleme.`;
}

export async function runCoverageFixUp(input: FixUpInput): Promise<FixUpResult> {
  const result = await callClaude({
    prompt: buildPrompt(input),
    maxTokens: 6000,
    model: MODEL_QUALITY,
  });

  // Strip any 'Üretim Bilgisi' footer the model might have copied —
  // documentationJob writes a fresh one with updated coverage.
  let text = cleanGeneratedMarkdown(result.text);
  const footerIdx = text.lastIndexOf("### Üretim Bilgisi");
  if (footerIdx > 0) {
    // Trim back to the `---` that precedes the footer
    const beforeFooter = text.slice(0, footerIdx).trimEnd();
    text = beforeFooter.replace(/\n---\s*$/, "").trimEnd();
  }

  return {
    content: text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens ?? 0,
    cacheCreationTokens: result.cacheCreationTokens ?? 0,
    addedCount: input.uiElementsMissing.length,
  };
}
