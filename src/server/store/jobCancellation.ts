// In-memory cancellation + pause state. Runner code consults these
// between steps to honor user requests (Durdur / Devam Et / İptal).

const cancelled = new Set<string>();
const paused = new Set<string>();

export const jobCancellation = {
  cancel(jobId: string): void {
    cancelled.add(jobId);
    paused.delete(jobId); // unpause so the loop can observe cancellation
  },
  isCancelled(jobId: string): boolean {
    return cancelled.has(jobId);
  },
  clear(jobId: string): void {
    cancelled.delete(jobId);
    paused.delete(jobId);
  },

  pause(jobId: string): void {
    paused.add(jobId);
  },
  resume(jobId: string): void {
    paused.delete(jobId);
  },
  isPaused(jobId: string): boolean {
    return paused.has(jobId);
  },

  /**
   * Block the runner while a job is paused. Returns false if the job
   * was cancelled while paused (caller should bail). Returns true to
   * continue. Polls every 500ms.
   */
  async waitIfPaused(jobId: string): Promise<boolean> {
    while (paused.has(jobId)) {
      if (cancelled.has(jobId)) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return !cancelled.has(jobId);
  },
};

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job cancelled: ${jobId}`);
    this.name = "JobCancelledError";
  }
}
