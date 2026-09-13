/**
 * LLM-doğrulamalı coverage — `computeCoverage` substring/2-gram match
 * "label gövdede geçti" der ama "anlamlı şekilde anlatıldı" garanti
 * etmez (örn. "Kaydet butonu ekranda görünür" anlatım değil, sadece
 * bahis). Bu sahte coverage analisti yanıltır.
 *
 * Çözüm: substring olarak "covered" işaretlenen öğeleri Haiku'ya
 * sorarak "gerçekten anlatılmış mı?" doğrula. Pozitif tarafta
 * gerçekten açıklananları tut; negatif tarafta listeyi "missing"e
 * geri taşı → fix-up turu doğru hedeflere yönelir.
 *
 * Maliyet: Haiku 4.5 ~$1/M input, ~$5/M output. Bir doc + element
 * listesi ≈ 5K input × 50 ekran = 250K ≈ $0.25/job. Pratik olarak sıfır.
 *
 * FAIL-CLOSED: Bu bir DOĞRULUK aracı — belirsizlikte güvenli taraf "eksik"
 * saymaktır (fix-up doğru hedefe yönelsin, sahte "covered" kalmasın):
 *  - Judge bir öğe için verdict döndürmediyse (label eşleşmedi / atladı) o öğe
 *    "belirsiz" → missing'e taşınır (eskiden sessizce covered kalıyordu).
 *  - Judge çağrısı komple başarısızsa raw coverage döner ama `verified:false`
 *    ile işaretlenir → screenProcessor bunu görünür uyarıya çevirir (eskiden
 *    doğrulama sessizce atlanıyordu, kullanıcı fark etmiyordu).
 */

import type { UIElement } from "../types/screen";
import { callClaude, MODEL_FAST, type ClaudeImage } from "../llm/claudeClient";
import { computeCoverage, type CoverageReport } from "./coverageCheck";

const JUDGE_MODEL = MODEL_FAST;

/** Verdict eşleşmesini sağlamlaştırır: Haiku label'ı birebir yazmayabilir
 *  (boşluk/diakritik/büyük-küçük farkı) → normalize edilmiş anahtar kullan. */
function normLabel(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

interface JudgeVerdict {
  label: string;
  /** true = anlatılmış, false = sadece bahis veya hiç yok */
  explained: boolean;
}

function buildJudgePrompt(
  body: string,
  candidates: UIElement[]
): string {
  const list = candidates
    .map((el, i) => `${i + 1}. "${el.label}" (${el.type}) — beklenen: ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");
  return `Aşağıda kullanıcı kılavuzu taslağı ve bir UI öğeleri listesi var.

Sana ekran görselleri de verildi. Her UI öğesi için sor: "Bu öğe dökümanda
**anlamlı VE doğru** anlatılmış mı?"
- Anlamlı = ne işe yaradığı + nasıl kullanılacağı yazılı
- Anlamsız = sadece etiket geçiyor ama açıklanmıyor (örn. "X butonu görünür" yetmez)
- **YANLIŞ/UYDURMA = explained:false yap:** dökümandaki anlatım görselle
  çelişiyorsa ya da görselde olmayan bir davranış/alan/mesaj/değer uydurulmuşsa
  (görsel kanıtı yok) o öğe için explained:false ver.

UI ÖĞELERİ:
${list}

DOKÜMAN:
\`\`\`
${body}
\`\`\`

Yanıtı **sadece JSON** olarak ver (başka metin yok):
{ "verdicts": [{ "label": "...", "explained": true|false }, ...] }

Her öğe için bir verdict olmak zorunda; listenin sırası bozulabilir
ama etiketler (label) yukarıdakiyle bire bir aynı olmalı.`;
}

async function judgeCovered(
  body: string,
  covered: UIElement[],
  images?: ClaudeImage[]
): Promise<Map<string, boolean>> {
  if (covered.length === 0) return new Map();
  const result = await callClaude({
    prompt: buildJudgePrompt(body, covered),
    model: JUDGE_MODEL,
    maxTokens: Math.min(8000, 200 + covered.length * 40),
    // Ana ekran + TEMSİLİ state görselleri → judge, sekme/modal/dolu-form
    // bölümlerindeki uydurmayı da görselle karşılaştırıp yakalayabilir
    // (yalnız ana görselle bu bölümler kör noktaydı). Judge Haiku (ucuz);
    // görsel kümesi çağıran tarafça sınırlanır.
    ...(images && images.length > 0 ? { images } : {}),
  });
  const m = result.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Judge yanıtında JSON yok: ${result.text.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]) as { verdicts?: JudgeVerdict[] };
  const verdicts = parsed.verdicts ?? [];
  const out = new Map<string, boolean>();
  for (const v of verdicts) {
    if (typeof v.label === "string" && typeof v.explained === "boolean") {
      out.set(normLabel(v.label), v.explained);
    }
  }
  return out;
}

/**
 * `computeCoverage` çalıştırır, sonra "covered" işaretli öğeleri Haiku
 * judge'a verir; "anlamlı anlatılmadı" denenler `missing`'e geri taşınır.
 *
 * Haiku çağrısı başarısız (network, parse, model) olursa orijinal
 * substring coverage döndürülür + warn log'lanır. Asla regresyon
 * yapmaz.
 */
export async function computeVerifiedCoverage(
  elements: UIElement[],
  body: string,
  images?: ClaudeImage[]
): Promise<CoverageReport> {
  const raw = computeCoverage(elements, body);
  const coveredEls = elements.filter((el) => {
    const missingTag = `${el.label} (${el.type})`;
    return !raw.missing.includes(missingTag);
  });
  if (coveredEls.length === 0) return { ...raw, verified: true };

  let verdicts: Map<string, boolean>;
  try {
    verdicts = await judgeCovered(body, coveredEls, images);
  } catch (e) {
    // Judge komple başarısız → raw döndür ama `verified:false` işaretle.
    // Sessiz atlama YOK: screenProcessor bunu görünür uyarıya çevirir.
    console.warn(`[coverage-judge] başarısız, raw coverage'a fallback (verified:false):`, (e as Error).message);
    return { ...raw, verified: false };
  }

  // FAIL-CLOSED: verdict 'false' VEYA hiç yoksa (judge öğeyi atladı/label
  // eşleşmedi) → "belirsiz" kabul et, missing'e taşı. Yalnız açıkça
  // 'explained:true' olanlar covered kalır.
  const downgraded: string[] = [];
  for (const el of coveredEls) {
    const v = verdicts.get(normLabel(el.label));
    if (v !== true) downgraded.push(`${el.label} (${el.type})`);
  }
  if (downgraded.length === 0) return { ...raw, verified: true };

  const missing = [...raw.missing, ...downgraded];
  const covered = raw.coveredElements - downgraded.length;
  const total = raw.totalElements;
  return {
    totalElements: total,
    coveredElements: covered,
    coveragePct: total > 0 ? Math.round((covered / total) * 100) : 100,
    missing,
    verified: true,
  };
}
