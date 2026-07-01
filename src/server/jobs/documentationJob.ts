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
import { processScreen } from "./screenProcessor";

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
  selectedScreenPaths: string[]
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

  // Paralel worker'lar arasında ortak completed sayacı.
  let completed = 0;
  const getCompleted = () => completed;
  const incCompleted = () => ++completed;

  await processInParallel(selectedScreenPaths, CONCURRENCY, async (screenPath) => {
    await processScreen({
      jobId,
      screenPath,
      allSections,
      allEndpoints,
      templateContents,
      total,
      getCompleted,
      incCompleted,
    });
  });

  const wasCancelled = jobCancellation.isCancelled(jobId);
  jobCancellation.clear(jobId);

  // GERÇEKTEN kaç doküman üretildi? `completed` sayacı hem başarı hem hata
  // ekranını sayar (screenProcessor catch'te de artar). documentStore'a
  // bakmak doğru ölçüdür: hiç doküman yoksa "Tüm dökümanlar oluşturuldu"
  // demek yanıltıcıydı (kullanıcı başarı görüp Dökümanlar sayfasını boş
  // buluyordu — örn. Claude kullanım limiti / auth / analiz hatası).
  const createdDocs = documentStore.getByJobId(jobId).length;
  const allFailed = !wasCancelled && createdDocs === 0 && total > 0;
  const partial = !wasCancelled && createdDocs > 0 && createdDocs < total;
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
      ? `${createdDocs}/${total} doküman üretildi — ${recordedError}`
      : `${createdDocs}/${total} doküman üretildi (bazı ekranlar başarısız — eksikler için 'Eksikleri Üret').`;
    if (recordedError) error = recordedError;
  } else {
    status = "completed"; eventType = "complete";
    message = "Tüm dökümanlar oluşturuldu";
  }

  jobStore.update(jobId, {
    status,
    completedAt: new Date().toISOString(),
    progress: { current: completed, total, message },
    ...(error ? { error } : {}),
  });
  emitJobEvent(jobId, { type: eventType, message, current: completed, total });
}
