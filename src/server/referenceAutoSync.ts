/**
 * Referans oto-senkron + OAuth token canlı tutma — Analyst Studio tasarımı.
 *
 * Sorun: Atlassian döner refresh token'ı 90 gün kullanılmayınca düşer; DocAgent
 * yalnız elle "Senkronize et" denince token yeniliyordu → 132 gün sonra
 * "refresh_token is invalid". Analyst Studio günde bir otomatik sync yapar,
 * bu da token'ı her gün yeniler → hiç bayatlamaz.
 *
 * Davranış: açılıştan 20 sn sonra ve her saat başı kontrol; bağlantı varsa,
 * kayıtlı kaynak varsa, bugün sync olmadıysa, aktif job/sync yoksa tüm
 * kaynakları senkronize eder (elle "Senkronize et" ile aynı iş). Kaynak yoksa
 * bile token'ı günde bir yeniler (keep-alive). AUTO_REF_SYNC=false kapatır.
 */
import { env } from "../config/env";
import { referenceStore } from "./store/referenceStore";
import { jobStore } from "./store/jobStore";
import { getStoredTokens, getValidAccessToken } from "./auth/atlassianAuth";
import { syncConfluenceSpace, syncJiraProject } from "../ingestion/sourceSync";

const BOOT_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;
let lastKeepAlive = 0;

function syncedToday(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return referenceStore.getSources().some((s) => (s.lastSync ?? "").startsWith(today));
}

function busy(): boolean {
  return jobStore.getAll().some((j) => j.status === "running" || j.status === "pending");
}

/** Tüm kayıtlı kaynakları senkronize eder (route ile aynı). Dışarıdan da çağrılabilir. */
export async function syncAllSources(reason: string): Promise<{ ok: boolean; log: string[]; errors: string[] }> {
  if (running) return { ok: false, log: [], errors: ["senkron zaten sürüyor"] };
  running = true;
  const log: string[] = [];
  const errors: string[] = [];
  try {
    for (const src of referenceStore.getSources()) {
      try {
        const result = src.kind === "confluence-space"
          ? await syncConfluenceSpace(src.key)
          : await syncJiraProject(src.key);
        referenceStore.updateSource(src.id, { lastSync: new Date().toISOString(), itemCount: result.count });
        log.push(...result.log);
        console.log(`[ref-sync:${reason}] ${src.kind} ${src.key}: ${result.count} öğe`);
      } catch (err) {
        const msg = `${src.key}: ${(err as Error).message}`;
        errors.push(msg);
        log.push(`✗ ${msg}`);
        console.warn(`[ref-sync:${reason}] ${msg}`);
      }
    }
  } finally {
    running = false;
  }
  return { ok: errors.length === 0, log, errors };
}

async function tick(): Promise<void> {
  if (!env.autoRefSync) return;
  if (!getStoredTokens()) return;
  if (running || busy()) return;
  const sources = referenceStore.getSources();
  if (sources.length > 0) {
    if (syncedToday()) return;
    console.log("[ref-sync] günlük otomatik senkron başlıyor (token da yenilenir)");
    await syncAllSources("oto-gunluk");
    return;
  }
  // Kaynak yok: yalnız token keep-alive (günde bir yenile).
  if (Date.now() - lastKeepAlive < 20 * 3600_000) return;
  try {
    await getValidAccessToken();
    lastKeepAlive = Date.now();
    console.log("[ref-sync] token keep-alive tamam");
  } catch (e) {
    console.warn("[ref-sync] token keep-alive başarısız:", (e as Error).message);
  }
}

export function startReferenceAutoSync(): void {
  if (timer) return;
  if (!env.autoRefSync) { console.log("[ref-sync] otomatik senkron KAPALI (AUTO_REF_SYNC=false)"); return; }
  setTimeout(() => { tick().catch(() => {}); }, BOOT_DELAY_MS).unref();
  timer = setInterval(() => { tick().catch(() => {}); }, CHECK_INTERVAL_MS);
  timer.unref();
  console.log("[ref-sync] otomatik senkron açık (günde bir; Atlassian token'ı canlı tutulur)");
}
