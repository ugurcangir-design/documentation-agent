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

  jobStore.update(jobId, {
    status: wasCancelled ? "failed" : "completed",
    completedAt: new Date().toISOString(),
    progress: {
      current: completed,
      total,
      message: wasCancelled ? "Kullanıcı tarafından iptal edildi" : "Tüm dökümanlar oluşturuldu",
    },
    ...(wasCancelled ? { error: "Cancelled by user" } : {}),
  });
  emitJobEvent(jobId, {
    type: wasCancelled ? "cancelled" : "complete",
    message: wasCancelled ? "İptal edildi" : "Tüm dökümanlar oluşturuldu",
    current: completed,
    total,
  });
}
