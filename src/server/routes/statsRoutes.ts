import { Router, type Request, type Response } from "express";
import { documentStore } from "../store/documentStore";
import { jobStore } from "../store/jobStore";
import { screenStore } from "../store/screenStore";
import { referenceStore } from "../store/referenceStore";

const router = Router();

// Claude Sonnet pricing (USD per million tokens)
const INPUT_PRICE = 3.0;
const OUTPUT_PRICE = 15.0;

router.get("/", (_req: Request, res: Response) => {
  const docs = documentStore.getAll();
  const jobs = jobStore.getAll();
  const screens = screenStore.getAll();
  const refs = referenceStore.getAll();

  const inputTokens = docs.reduce((s, d) => s + (d.inputTokens ?? 0), 0);
  const outputTokens = docs.reduce((s, d) => s + (d.outputTokens ?? 0), 0);
  const totalCostUsd =
    (inputTokens / 1_000_000) * INPUT_PRICE +
    (outputTokens / 1_000_000) * OUTPUT_PRICE;

  const recentJobs = jobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentDocs = docs
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      screenTitle: d.screenTitle,
      screenPath: d.screenPath,
      status: d.status,
      updatedAt: d.updatedAt,
    }));

  res.json({
    documents: {
      total: docs.length,
      draft: docs.filter((d) => d.status === "draft").length,
      approved: docs.filter((d) => d.status === "approved").length,
      published: docs.filter((d) => d.status === "published").length,
    },
    jobs: {
      total: jobs.length,
      running: jobs.filter((j) => j.status === "running").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    },
    screens: { total: screens.length },
    references: {
      confluence: refs.confluence.length,
      swagger: refs.swagger.length,
      documents: refs.documents.filter((d) => d.type !== "template").length,
      templates: refs.documents.filter((d) => d.type === "template").length,
    },
    usage: {
      inputTokens,
      outputTokens,
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    },
    recentJobs,
    recentDocs,
  });
});

export default router;
