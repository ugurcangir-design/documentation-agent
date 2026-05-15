import fs from "fs";
import path from "path";

export type JobType = "discovery" | "documentation";
export type JobStatus = "pending" | "running" | "completed" | "failed";

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
}

const DB_PATH = path.join(process.cwd(), "data", "db", "jobs.json");

function ensureDir(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load(): Job[] {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8")) as Job[];
}

function save(jobs: Job[]): void {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(jobs, null, 2));
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
};
