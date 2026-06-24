import { Router, type Request, type Response } from "express";
import { documentStore } from "../store/documentStore";
import { jobStore } from "../store/jobStore";
import { screenStore } from "../store/screenStore";
import { referenceStore } from "../store/referenceStore";
import { aggregateUsage } from "../../quality/usageCost";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  const docs = documentStore.getAll();
  const jobs = jobStore.getAll();
  const screens = screenStore.getAll();
  const refs = referenceStore.getAll();

  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalCostUsd } =
    aggregateUsage(docs);

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
      cacheReadTokens,
      cacheCreationTokens,
      totalCostUsd,
    },
    recentJobs,
    recentDocs,
  });
});

export default router;
