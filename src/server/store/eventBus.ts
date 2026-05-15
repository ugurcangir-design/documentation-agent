import { EventEmitter } from "events";

export interface JobEvent {
  type: "progress" | "screen" | "complete" | "error";
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
