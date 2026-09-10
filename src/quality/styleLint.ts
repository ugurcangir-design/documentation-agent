/**
 * Stil denetimi (STYLE_LINT=true, varsayılan açık) — üretilmiş kılavuz
 * bölümlerini ucuz modelle (Haiku) YALNIZ BİÇİMSEL olarak düzeltir:
 *   - UI öğe adları (buton/alan/sekme adları) **kalın** yazılır
 *   - Numaralı adımlar sıralı ve tutarlıdır (1,2,3… — atlama/tekrar yok)
 *   - Yasak geliştirici jargonu Türkçe karşılığıyla değiştirilir
 *     (component, state, props, endpoint, validation, submit …)
 *
 * İçerik DEĞİŞMEZ: cümle yeniden yazma, ekleme/çıkarma yok. Guardrail (biçimsel
 * geçiş anlam bozamaz):
 *   - uzunluk ±%15 içinde olmalı,
 *   - görsel embed URL KÜMESİ birebir korunmalı (sayı değil KÜME — yanlış
 *     ekrana işaret eden path değişimi de yakalanır),
 *   - gömülü (inline) SAYILAR korunmalı ("50 karakter" → "5 karakter" gibi
 *     olgusal sapmayı yakalar; satır-başı liste numaraları hariç — onları
 *     yeniden numaralandırmak meşru),
 *   - POLARİTE terimlerinin sayısı korunmalı ("zorunlu"↔"opsiyonel",
 *     "değil"/"yok" gibi anlam-çeviren kelimeler eklenip/çıkarılamaz).
 * Herhangi biri ihlal → çıktı OTOMATİK REDDEDİLİR, orijinal korunur.
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Görsel embed URL kümesi (sıralı) — sayı değil KÜME korunur ki bir görselin
 *  path'i başka bir görselinkiyle değiştirilse (yanlış ekran) yakalansın. */
function imageUrls(md: string): string[] {
  const urls: string[] = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) urls.push((m[1] ?? "").trim());
  return urls.sort();
}

/** Gömülü sayılar — satır-başı liste işaretçileri (1. / 2)) HARİÇ (styleLint
 *  bunları yeniden numaralandırabilir). "50 karakter"→"5 karakter" yakalanır. */
function inlineNumbers(md: string): string[] {
  const stripped = md.replace(/^\s*\d+[.)]\s+/gm, "");
  return (stripped.match(/\d+/g) ?? []).sort();
}

/** Anlamı çeviren polarite kelimelerinin sayisal parmak izi — biçimsel
 *  düzeltme bunları ekleyemez/çıkaramaz/çeviremez. */
const POLARITY_TERMS = [
  "zorunlu", "zorunludur", "opsiyonel", "opsiyoneldir", "gerekli", "gereksiz",
  "değil", "yok", "aktif", "pasif", "evet", "hayır",
];
function polarityFingerprint(md: string): string {
  const low = md.toLowerCase();
  return POLARITY_TERMS
    .map((t) => {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t)}(?![\\p{L}\\p{N}])`, "giu");
      return `${t}:${(low.match(re) ?? []).length}`;
    })
    .join(",");
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
    // Guardrail: biçimsel geçiş anlam bozamaz. Uzunluk + görsel-URL kümesi +
    // inline sayılar + polarite terimleri korunmalı; ihlalde orijinali koru.
    const ratio = out.length / section.length;
    const imgOk = sameMultiset(imageUrls(out), imageUrls(section));
    const numOk = sameMultiset(inlineNumbers(out), inlineNumbers(section));
    const polOk = polarityFingerprint(out) === polarityFingerprint(section);
    if (ratio < 0.85 || ratio > 1.15 || !imgOk || !numOk || !polOk) {
      console.warn(
        `[styleLint] guardrail reddi (oran=${ratio.toFixed(2)}, görselOK=${imgOk}, ` +
        `sayıOK=${numOk}, polariteOK=${polOk}) — orijinal korundu`
      );
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
