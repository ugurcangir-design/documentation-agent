/**
 * Zamanlanmış tazeleme — opt-in (varsayılan KAPALI). Etkinken periyodik olarak
 * tüm keşfedilmiş ekranlar için üretim job'ı başlatır; artımlı skip sayesinde
 * DEĞİŞMEYEN ekranlar atlanır (0 token), yalnız kaynak/analiz değişen ekranlar
 * yeniden üretilir → doküman "canlı" kalır.
 *
 * GÜVENLİK: yalnız ÜRETİMi tazeler, RE-DISCOVERY yapmaz. Otomatik tarayıcı
 * gezmesi (login/dinamik-sayfa riskleri) gözetimsiz çalıştırılmaz; ekranların
 * yeniden keşfi bilinçli olarak manuel (Ekran Keşfi) bırakıldı.
 *
 * Lazy-env dostu: kısa aralıklı bir denetleyici her turda `env.scheduleEnabled`
 * ve geçen süreyi kontrol eder → Ayarlar'dan açıp kapatmak restart gerektirmez.
 */

import { v4 as uuid } from "uuid";
import { env } from "../config/env";
import { screenStore } from "./store/screenStore";
import { jobStore } from "./store/jobStore";
import { runDocumentationJob } from "./jobs/documentationJob";

const CHECK_INTERVAL_MS = 15 * 60_000; // 15 dk'da bir "vakti geldi mi" bak
let timer: NodeJS.Timeout | null = null;
let lastRun = 0;
let running = false;

async function refresh(): Promise<void> {
  if (running) { console.log("[scheduler] önceki tazeleme sürüyor — atlanıyor"); return; }
  const screens = screenStore.getAll();
  if (screens.length === 0) { console.log("[scheduler] keşfedilmiş ekran yok — atlanıyor"); return; }
  const busy = jobStore.getAll().some(
    (j) => j.type === "documentation" && (j.status === "running" || j.status === "pending")
  );
  if (busy) { console.log("[scheduler] aktif doküman job'ı var — atlanıyor"); return; }

  running = true;
  const jobId = uuid();
  const paths = screens.map((s) => s.path);
  const now = new Date().toISOString();
  jobStore.create({
    id: jobId, type: "documentation", status: "pending",
    createdAt: now, updatedAt: now,
    progress: { current: 0, total: paths.length, message: "Zamanlanmış tazeleme..." },
    screenPaths: paths,
  });
  console.log(`[scheduler] zamanlanmış tazeleme başladı (${paths.length} ekran; değişmeyenler atlanır)`);
  try {
    await runDocumentationJob(jobId, paths, false);
  } catch (e) {
    console.warn("[scheduler] tazeleme hatası:", (e as Error).message);
  } finally {
    running = false;
  }
}

async function maybeRefresh(): Promise<void> {
  if (!env.scheduleEnabled) return;
  const intervalMs = Math.max(1, env.scheduleIntervalHours) * 3600_000;
  if (Date.now() - lastRun < intervalMs) return;
  lastRun = Date.now();
  await refresh();
}

/** app.ts başlangıcında çağrılır. Denetleyici her zaman kurulur; kapalıyken
 *  no-op'tur (lazy-env → Ayarlar'dan açmak restart gerektirmez). */
export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { void maybeRefresh(); }, CHECK_INTERVAL_MS);
  // process bloklamasın (tek başına app'i ayakta tutmasın)
  if (typeof timer.unref === "function") timer.unref();
}
