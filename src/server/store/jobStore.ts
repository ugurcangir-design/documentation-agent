import path from "path";
import { writeJsonAtomic, readJsonSafe } from "./atomicJson";

export type JobType = "discovery" | "documentation";
export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: {
    current: number;
    total: number;
    message: string;
  };
  error?: string;
  /** Documentation job için kullanıcı tarafından seçilen ekran path'leri.
   *  Failed/cancelled job'larda "eksik ekranları tekrar üret" özelliği
   *  bunu kullanır: original screenPaths \ üretilmiş documents.screenPath
   *  = eksik set. Geriye dönük uyumluluk: eski job'larda undefined. */
  screenPaths?: string[];
}

const DB_PATH = path.join(process.cwd(), "data", "db", "jobs.json");

function load(): Job[] {
  return readJsonSafe<Job[]>(DB_PATH, []);
}

function save(jobs: Job[]): void {
  writeJsonAtomic(DB_PATH, jobs);
}

export const jobStore = {
  getAll(): Job[] {
    return load();
  },

  getById(id: string): Job | undefined {
    return load().find((j) => j.id === id);
  },

  create(job: Job): void {
    const jobs = load();
    jobs.push(job);
    save(jobs);
  },

  update(id: string, patch: Partial<Job>): void {
    const jobs = load();
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) return;
    jobs[idx] = { ...jobs[idx], ...patch, updatedAt: new Date().toISOString() } as Job;
    save(jobs);
  },

  getLatest(type: JobType): Job | undefined {
    return load()
      .filter((j) => j.type === type)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() -
          new Date(a.createdAt).getTime()
      )[0];
  },

  delete(id: string): boolean {
    const jobs = load();
    const filtered = jobs.filter((j) => j.id !== id);
    if (filtered.length === jobs.length) return false;
    save(filtered);
    return true;
  },

  /** Delete all jobs whose status is in the given set (default: all
   *  terminal states). Returns how many were removed. */
  deleteWhere(predicate: (j: Job) => boolean): number {
    const jobs = load();
    const remaining = jobs.filter((j) => !predicate(j));
    const removed = jobs.length - remaining.length;
    if (removed > 0) save(remaining);
    return removed;
  },
};
