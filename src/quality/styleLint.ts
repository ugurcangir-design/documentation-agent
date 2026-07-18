/**
 * Stil denetimi (STYLE_LINT=true, varsayılan açık) — üretilmiş kılavuz
 * bölümlerini ucuz modelle (Haiku) YALNIZ BİÇİMSEL olarak düzeltir:
 *   - UI öğe adları (buton/alan/sekme adları) **kalın** yazılır
 *   - Numaralı adımlar sıralı ve tutarlıdır (1,2,3… — atlama/tekrar yok)
 *   - Yasak geliştirici jargonu Türkçe karşılığıyla değiştirilir
 *     (component, state, props, endpoint, validation, submit …)
 *
 * İçerik DEĞİŞMEZ: cümle yeniden yazma, ekleme/çıkarma yok. Guardrail:
 * model çıktısı uzunlukça ±%15'ten fazla sapar veya görsel embed sayısı
 * değişirse çıktı OTOMATİK REDDEDİLİR ve orijinal korunur — stil denetimi
 * hiçbir koşulda içerik kaybettiremez.
 */

import { callClaude, MODEL_FAST } from "../llm/claudeClient";

export interface StyleLintResult {
  sections: string[];
  /** Kaç bölüm gerçekten değişti (guardrail'i geçen düzeltmeler). */
  changed: number;
  inputTokens: number;
  outputTokens: number;
}

const PROMPT_HEADER = `Aşağıdaki Türkçe kullanıcı kılavuzu bölümünü YALNIZ BİÇİMSEL olarak düzelt:

1. UI öğe adlarını (buton, alan, sekme, menü adları) **kalın** yap (zaten kalınsa dokunma).
2. Numaralı adım listelerini sıralı ve tutarlı yap (1,2,3… — atlama/tekrar düzelt).
3. Geliştirici jargonunu Türkçe karşılığıyla değiştir: component→bileşen, endpoint→servis, validation→doğrulama, submit→gönderme, state→durum, props/prop→özellik.

KESİN YASAKLAR:
- Cümleleri YENİDEN YAZMA, içerik EKLEME/ÇIKARMA, başlık değiştirme.
- Markdown görsel etiketlerine (![...](...)) DOKUNMA — aynen bırak.
- Düzeltilecek bir şey yoksa metni AYNEN döndür.

Yalnız düzeltilmiş bölümü döndür (açıklama/önsöz yok):

`;

function imageCount(md: string): number {
  return (md.match(/!\[/g) ?? []).length;
}

/** Tek bölümü lint'ler; guardrail'i geçemezse orijinali döndürür. */
async function lintSection(
  section: string
): Promise<{ text: string; changed: boolean; inTok: number; outTok: number }> {
  if (section.trim().length < 200) return { text: section, changed: false, inTok: 0, outTok: 0 };
  try {
    const result = await callClaude({
      prompt: PROMPT_HEADER + section,
      model: MODEL_FAST,
      // Bölüm uzunluğuna orantılı çıktı payı (char/3 ≈ token) + tampon.
      maxTokens: Math.min(16000, Math.ceil(section.length / 3) + 1500),
    });
    const out = result.text.trim();
    // Guardrail: uzunluk ±%15 içinde VE görsel sayısı birebir aynı olmalı —
    // aksi halde model içerik kaybettirmiş/eklemiş demektir → reddet.
    const ratio = out.length / section.length;
    if (ratio < 0.85 || ratio > 1.15 || imageCount(out) !== imageCount(section)) {
      console.warn(`[styleLint] guardrail reddi (oran=${ratio.toFixed(2)}, görsel ${imageCount(section)}→${imageCount(out)}) — orijinal korundu`);
      return { text: section, changed: false, inTok: result.inputTokens, outTok: result.outputTokens };
    }
    return {
      text: out,
      changed: out !== section.trim(),
      inTok: result.inputTokens,
      outTok: result.outputTokens,
    };
  } catch (e) {
    console.warn(`[styleLint] bölüm denetlenemedi — orijinal korundu: ${(e as Error).message}`);
    return { text: section, changed: false, inTok: 0, outTok: 0 };
  }
}

/** Bölümleri sırayla lint'ler (ucuz Haiku çağrıları). Hata/red → orijinal. */
export async function runStyleLint(sections: string[]): Promise<StyleLintResult> {
  const out: string[] = [];
  let changed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const s of sections) {
    const r = await lintSection(s);
    out.push(r.text);
    if (r.changed) changed++;
    inputTokens += r.inTok;
    outputTokens += r.outTok;
  }
  return { sections: out, changed, inputTokens, outputTokens };
}
