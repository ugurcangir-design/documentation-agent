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
 * Güvenli mod: Haiku çağrısı başarısız olursa raw substring coverage
 * korunur — kalite hiç bozulmaz, sadece doğrulama atlanır.
 */

import type { UIElement } from "../types/screen";
import { callClaude } from "../llm/claudeClient";
import { computeCoverage, type CoverageReport } from "./coverageCheck";

const JUDGE_MODEL = "claude-haiku-4-5";

interface JudgeVerdict {
  label: string;
  /** true = anlatılmış, false = sadece bahis veya hiç yok */
  explained: boolean;
}

function buildJudgePrompt(
  docKind: "userManual" | "technicalDoc",
  body: string,
  candidates: UIElement[]
): string {
  const list = candidates
    .map((el, i) => `${i + 1}. "${el.label}" (${el.type}) — beklenen: ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");
  return `Aşağıda ${docKind === "userManual" ? "kullanıcı kılavuzu" : "teknik döküman"} taslağı ve bir UI öğeleri listesi var.

Her UI öğesi için sor: "Bu öğe dökümanda **anlamlı şekilde** anlatılmış mı?"
- Anlamlı = ne işe yaradığı + nasıl kullanılacağı (kılavuz) veya spec'i (teknik) yazılı
- Anlamsız = sadece etiket geçiyor ama açıklanmıyor (örn. "X butonu görünür" yetmez)

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
  docKind: "userManual" | "technicalDoc",
  body: string,
  covered: UIElement[]
): Promise<Map<string, boolean>> {
  if (covered.length === 0) return new Map();
  const result = await callClaude({
    prompt: buildJudgePrompt(docKind, body, covered),
    model: JUDGE_MODEL,
    maxTokens: Math.min(8000, 200 + covered.length * 40),
  });
  const m = result.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Judge yanıtında JSON yok: ${result.text.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]) as { verdicts?: JudgeVerdict[] };
  const verdicts = parsed.verdicts ?? [];
  const out = new Map<string, boolean>();
  for (const v of verdicts) {
    if (typeof v.label === "string" && typeof v.explained === "boolean") {
      out.set(v.label.toLowerCase(), v.explained);
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
  docKind: "userManual" | "technicalDoc"
): Promise<CoverageReport> {
  const raw = computeCoverage(elements, body);
  const coveredEls = elements.filter((el) => {
    const missingTag = `${el.label} (${el.type})`;
    return !raw.missing.includes(missingTag);
  });
  if (coveredEls.length === 0) return raw;

  let verdicts: Map<string, boolean>;
  try {
    verdicts = await judgeCovered(docKind, body, coveredEls);
  } catch (e) {
    console.warn(`[coverage-judge] başarısız, raw coverage'a fallback:`, (e as Error).message);
    return raw;
  }

  const downgraded: string[] = [];
  for (const el of coveredEls) {
    const v = verdicts.get(el.label.toLowerCase());
    if (v === false) downgraded.push(`${el.label} (${el.type})`);
  }
  if (downgraded.length === 0) return raw;

  const missing = [...raw.missing, ...downgraded];
  const covered = raw.coveredElements - downgraded.length;
  const total = raw.totalElements;
  return {
    totalElements: total,
    coveredElements: covered,
    coveragePct: total > 0 ? Math.round((covered / total) * 100) : 100,
    missing,
  };
}
