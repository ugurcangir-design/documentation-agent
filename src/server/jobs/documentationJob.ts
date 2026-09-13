/**
 * Doküman üretim job orchestrator. Üç fazdan oluşur:
 *   1. loadJobContext         — referans kaynakları (BRD, Confluence, Jira,
 *                                Swagger, şablon) tek seferde okur.
 *   2. processScreen           — her ekran için analyze + generate + fixup +
 *                                trace + persist; CONCURRENCY=3 paralel.
 *   3. job status finalize     — completed / cancelled / failed.
 *
 * Karmaşık iş ayrı modüllerde (contextLoader, screenProcessor, traceBuilder);
 * bu dosya yalnızca akışı çalıştırır.
 */

import { jobStore } from "../store/jobStore";
import { documentStore } from "../store/documentStore";
import { emitJobEvent } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";
import { loadJobContext } from "./contextLoader";
import { processScreen, clearProgressThrottle } from "./screenProcessor";
import { checkPromptConfigHealth, loadPromptConfig } from "../../config/promptConfig";
import { computeGenFingerprint } from "../../quality/docFingerprint";

const CONCURRENCY = 3;

async function processInParallel<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item === undefined) continue;
      await worker(item, idx);
    }
  });
  await Promise.all(runners);
}

export async function runDocumentationJob(
  jobId: string,
  selectedScreenPaths: string[],
  force = false
): Promise<void> {
  const total = selectedScreenPaths.length;

  jobStore.update(jobId, {
    status: "running",
    progress: { current: 0, total, message: "Bağlam kaynakları yükleniyor..." },
  });
  emitJobEvent(jobId, {
    type: "progress",
    message: `Bağlam yükleniyor (Swagger + BRD + Confluence + şablonlar)...`,
    current: 0,
    total,
  });

  const { allEndpoints, allSections, templateContents } = await loadJobContext(jobId);

  emitJobEvent(jobId, {
    type: "progress",
    message: `Bağlam hazır: ${allEndpoints.length} endpoint, ${allSections.length} döküman bölümü, ${templateContents.length} şablon`,
    current: 0,
    total,
  });

  console.log(`[docjob ${jobId}] starting with ${selectedScreenPaths.length} paths`);

  // Prompt yapılandırması sağlığı — job-stable, bir kez denetlenir. Bozuksa
  // kritik guardrail'ler ("uydurma yasak") ve çıktı yapısı devrede olmayabilir;
  // canlı akışa bir kez uyarı bas, her dokümana da banner düşür (screenProcessor).
  const cfgHealth = checkPromptConfigHealth();
  const promptConfigProblems = cfgHealth.ok ? [] : cfgHealth.problems;
  if (!cfgHealth.ok) {
    console.warn(`[docjob ${jobId}] prompt yapılandırması eksik: ${cfgHealth.problems.join("; ")}`);
    emitJobEvent(jobId, {
      type: "error",
      message: `⚠️ Prompt yapılandırması eksik — üretilen dokümanların kalitesi düşebilir: ${cfgHealth.problems.join("; ")}`,
      current: 0,
      total,
    });
  }

  // Paralel worker'lar arasında ortak completed sayacı.
  let completed = 0;
  const getCompleted = () => completed;
  const incCompleted = () => ++completed;

  // Üretim-config parmak izi (job-stable): prompt config + şablonlar. Artımlı
  // üretimde ekran parmak izinin bir parçası; değişince tüm ekranlar yeniden üretilir.
  const genFp = computeGenFingerprint(
    loadPromptConfig("userManual"),
    loadPromptConfig("screenAnalysis"),
    templateContents
  );
  if (force) console.log(`[docjob ${jobId}] force=true — parmak izi eşleşse bile tüm ekranlar yeniden üretilecek`);

  // Ekran-başı "yumuşak" uyarılar + artımlı atlanan sayısı. Worker'lar
  // tek-thread event-loop'ta çalıştığından push/artırma yarışsızdır.
  const allWarnings: string[] = [];
  let skippedCount = 0;

  await processInParallel(selectedScreenPaths, CONCURRENCY, async (screenPath) => {
    const r = await processScreen({
      jobId,
      screenPath,
      allSections,
      allEndpoints,
      templateContents,
      total,
      getCompleted,
      incCompleted,
      promptConfigProblems,
      genFp,
      force,
    });
    if (r.warnings.length > 0) allWarnings.push(...r.warnings);
    if (r.skipped) skippedCount++;
  });

  const wasCancelled = jobCancellation.isCancelled(jobId);
  jobCancellation.clear(jobId);

  // GERÇEKTEN kaç doküman üretildi? `completed` sayacı hem başarı hem hata
  // ekranını sayar (screenProcessor catch'te de artar). documentStore'a
  // bakmak doğru ölçüdür: hiç doküman yoksa "Tüm dökümanlar oluşturuldu"
  // demek yanıltıcıydı (kullanıcı başarı görüp Dökümanlar sayfasını boş
  // buluyordu — örn. Claude kullanım limiti / auth / analiz hatası).
  const createdDocs = documentStore.getByJobId(jobId).length;
  // Artımlı üretim: ATLANAN ekranlar bu job'a yeni doküman EKLEMEZ (mevcut
  // doküman korunur) ama BAŞARIdır. "İşlenen" = üretilen + atlanan; başarısız
  // yalnız ikisi de değilse.
  const doneCount = createdDocs + skippedCount;
  const allFailed = !wasCancelled && doneCount === 0 && total > 0;
  const partial = !wasCancelled && doneCount > 0 && doneCount < total;
  const skipNote = skippedCount > 0 ? ` · ${skippedCount} değişmedi (atlandı, 0 token)` : "";
  // screenProcessor bir limit/hata durumunda job.error'a NET mesaj yazdı;
  // terminal mesajda onu göstererek kullanıcıyı bilgilendir.
  const recordedError = jobStore.getById(jobId)?.error;

  let status: "completed" | "failed";
  let message: string;
  let eventType: "complete" | "failed" | "cancelled";
  let error: string | undefined;

  if (wasCancelled) {
    status = "failed"; eventType = "cancelled";
    message = "Kullanıcı tarafından iptal edildi"; error = "Cancelled by user";
  } else if (allFailed) {
    status = "failed"; eventType = "failed";
    message = recordedError ??
      "Hiçbir doküman üretilemedi — üretim hatası (örn. Claude kullanım limiti, kimlik doğrulama veya analiz hatası). Sunucu loglarına / Geçmiş'e bakın.";
    error = message;
  } else if (partial) {
    status = "completed"; eventType = "complete";
    message = recordedError
      ? `${doneCount}/${total} ekran işlendi${skipNote} — ${recordedError}`
      : `${doneCount}/${total} ekran işlendi${skipNote} (bazı ekranlar başarısız — eksikler için 'Eksikleri Üret').`;
    if (recordedError) error = recordedError;
  } else {
    status = "completed"; eventType = "complete";
    message = skippedCount > 0
      ? `${createdDocs} üretildi${skipNote} — tümü güncel`
      : "Tüm dökümanlar oluşturuldu";
  }

  // "Yumuşak" uyarılar: doküman üretildi ama eksik/şüpheli olabilir. Job
  // 'completed' kalsa da terminal mesaja net bir özet ekle (sessiz başarı
  // yerine görünür "tamamlandı ama N uyarı") ve job'a kaydet.
  if (status === "completed" && allWarnings.length > 0) {
    const shown = allWarnings.slice(0, 3).join(" · ");
    message = `${message} — ⚠️ ${allWarnings.length} uyarı: ${shown}${allWarnings.length > 3 ? " …" : ""}`;
  }

  jobStore.update(jobId, {
    status,
    completedAt: new Date().toISOString(),
    progress: { current: completed, total, message },
    ...(error ? { error } : {}),
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
  });
  emitJobEvent(jobId, { type: eventType, message, current: completed, total });
  clearProgressThrottle(jobId);
}
