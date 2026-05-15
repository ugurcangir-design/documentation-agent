// In-memory set of cancelled job IDs. Runner code checks this between steps.

const cancelled = new Set<string>();

export const jobCancellation = {
  cancel(jobId: string): void {
    cancelled.add(jobId);
  },
  isCancelled(jobId: string): boolean {
    return cancelled.has(jobId);
  },
  clear(jobId: string): void {
    cancelled.delete(jobId);
  },
};

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job cancelled: ${jobId}`);
    this.name = "JobCancelledError";
  }
}
