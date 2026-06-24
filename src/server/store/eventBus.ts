import { EventEmitter } from "events";

export interface JobEvent {
  // Terminal job olayları: complete | failed | cancelled (stream kapanır).
  // "error" job'ı SONLANDIRMAZ — tek bir ekranın hatasını bildirir, job
  // diğer ekranlarla devam eder (frontend log'a yazar ama stream'i kapatmaz).
  type: "progress" | "screen" | "complete" | "error" | "failed" | "cancelled";
  message: string;
  current?: number;
  total?: number;
  data?: unknown;
}

class JobEventBus extends EventEmitter {}

export const eventBus = new JobEventBus();
eventBus.setMaxListeners(50);

export function emitJobEvent(
  jobId: string,
  event: JobEvent
): void {
  eventBus.emit(`job:${jobId}`, event);
}
