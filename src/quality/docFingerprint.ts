/**
 * Artımlı üretim parmak izi — bir ekranın kılavuz ÇIKTISINI belirleyen
 * girdilerin özeti. İki koşu arasında parmak izi AYNIysa, üretim tekrar
 * çalıştırıldığında (LLM non-determinizmi dışında) eşdeğer bir doküman
 * çıkardı → o ekranı yeniden üretmek yerine mevcut dokümanı koru = 0 token.
 *
 * Sinyal PİKSEL DEĞİL, ANALİZ+BAĞLAM tabanlıdır: canlı-veri ekranlarında
 * ekran görüntüsü her yakalamada değişir ama UI öğeleri/iş akışları ve
 * ilgili kaynak bölümleri stabildir. Böylece dinamik ekranlarda bile
 * (analiz cache'i sayesinde ucuz analizi ödeyip) PAHALI üretim atlanır.
 *
 * KRİTİK: parmak izi yalnız çıktı-belirleyici, KARARLI alanları içerir.
 * Yanlış tarafta hata (gereksiz yeniden üretim) güvenli; asla bayat doküman
 * servis edilmez çünkü değişen her anlamlı girdi izi değiştirir.
 */

import crypto from "crypto";
import type { ScreenAnalysis } from "../types/screen";
import type { PreparedChunk } from "../retrieval/contextBudget";

/** Üretim mantığı/promptu esaslı değiştiğinde artır → tüm dokümanlar bir
 *  sonraki koşuda yeniden üretilir (eski parmak izleri geçersiz kalır). */
export const GEN_FINGERPRINT_VERSION = "gen-v1";

function md5(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}

/** Üretim-config parmak izi (job-stable): prompt config + şablonlar. Bir kez
 *  hesaplanıp tüm ekranlara verilir. Değişince tüm ekranlar yeniden üretilir. */
export function computeGenFingerprint(
  userManualCfg: unknown,
  screenAnalysisCfg: unknown,
  templateContents: string[]
): string {
  return md5(
    JSON.stringify({
      v: GEN_FINGERPRINT_VERSION,
      um: userManualCfg ?? {},
      sa: screenAnalysisCfg ?? {},
      tpl: templateContents.map((t) => md5(t)),
    })
  );
}

/** Ekran-düzeyi parmak izi: analiz (UI öğeleri/iş akışları/amaç) + bu ekrana
 *  seçilmiş RAG chunk'ları + state etiketleri + üretim-config izi. */
export function computeDocFingerprint(input: {
  analysis: ScreenAnalysis;
  preparedChunks: PreparedChunk[];
  stateLabels: string[];
  genFp: string;
}): string {
  const a = input.analysis;
  const analysisSig = {
    t: a.screenTitle ?? "",
    p: a.purpose ?? "",
    ui: (a.uiElements ?? []).map(
      (e) => `${e.type}|${e.label}|${e.description ?? ""}|${e.action ?? ""}`
    ),
    wf: (a.workflows ?? []).map(
      (w) => `${w.name}|${(w.steps ?? []).join(">")}`
    ),
  };
  const ctxSig = input.preparedChunks.map(
    (c) => `${c.sourceType}|${c.title}|${md5(c.content)}`
  );
  return md5(
    JSON.stringify({
      g: input.genFp,
      a: analysisSig,
      c: ctxSig,
      s: [...input.stateLabels].sort(),
    })
  );
}

/** Mevcut doküman "eksik/şüpheli" işaretli mi? (kalite uyarı banner'ları).
 *  Öyleyse parmak izi eşleşse bile ATLAMA — düzeltme şansı için yeniden üret. */
export function docHasQualityWarning(content: string): boolean {
  return /EKSİK İÇERİK|ÇIKTI KESİLMİŞ|KAPSAM ÖLÇÜLEMEDİ|KAPSAM DOĞRULANAMADI|PROMPT YAPILANDIRMASI EKSİK/.test(
    content
  );
}
