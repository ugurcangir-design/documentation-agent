import { Router, type Request, type Response } from "express";

import { documentStore, type DocumentStatus } from "../store/documentStore";
import { parseSections, regenerateSection } from "../../generator/sectionRegenerator";

const router = Router();

// GET /api/documents
router.get("/", (_req: Request, res: Response) => {
  res.json(documentStore.getAll());
});

// GET /api/documents/grouped — grouped by screenPath
router.get("/grouped", (_req: Request, res: Response) => {
  res.json(documentStore.groupByScreen());
});

// GET /api/documents/:id
router.get("/:id", (req: Request, res: Response) => {
  const doc = documentStore.getById(req.params.id as string);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

// PUT /api/documents/:id — update content
router.put("/:id", (req: Request, res: Response) => {
  const { userManualContent, technicalDocContent } = req.body as {
    userManualContent?: string;
    technicalDocContent?: string;
  };

  const updated = documentStore.update(req.params.id as string, {
    ...(userManualContent !== undefined ? { userManualContent } : {}),
    ...(technicalDocContent !== undefined ? { technicalDocContent } : {}),
  });

  if (!updated) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(updated);
});

// PATCH /api/documents/:id/status — change status
router.patch("/:id/status", (req: Request, res: Response) => {
  const { status } = req.body as { status: DocumentStatus };

  const validStatuses: DocumentStatus[] = [
    "draft",
    "approved",
    "published",
  ];

  if (!validStatuses.includes(status)) {
    res
      .status(400)
      .json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const patch: Partial<typeof documentStore.getAll extends () => (infer T)[] ? T : never> =
    { status };

  if (status === "published") {
    (patch as Record<string, unknown>).publishedAt =
      new Date().toISOString();
  }

  const updated = documentStore.update(
    req.params.id as string,
    patch as Parameters<typeof documentStore.update>[1]
  );

  if (!updated) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(updated);
});

// GET /api/documents/:id/sections?target=userManual|technicalDoc
router.get("/:id/sections", (req: Request, res: Response) => {
  const doc = documentStore.getById(req.params["id"] as string);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const target = (req.query["target"] as string) ?? "userManual";
  const content = target === "technicalDoc" ? doc.technicalDocContent : doc.userManualContent;
  const sections = parseSections(content).map((s) => ({ heading: s.heading, level: s.level }));
  res.json(sections);
});

// POST /api/documents/:id/regenerate-section
router.post("/:id/regenerate-section", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const { sectionHeading, instruction, target } = req.body as {
    sectionHeading: string;
    instruction: string;
    target: "userManual" | "technicalDoc";
  };

  if (!sectionHeading || !instruction || !target) {
    res.status(400).json({ error: "sectionHeading, instruction, target required" });
    return;
  }

  const doc = documentStore.getById(id);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const fullDocument = target === "technicalDoc" ? doc.technicalDocContent : doc.userManualContent;

  try {
    const result = await regenerateSection({
      fullDocument,
      sectionHeading,
      instruction,
      docType: target,
    });

    const patch = target === "technicalDoc"
      ? { technicalDocContent: result.newContent }
      : { userManualContent: result.newContent };

    const updated = documentStore.update(
      id,
      {
        ...patch,
        inputTokens: (doc.inputTokens ?? 0) + result.inputTokens,
        outputTokens: (doc.outputTokens ?? 0) + result.outputTokens,
      },
      "regenerate"
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/documents/:id/versions
router.get("/:id/versions", (req: Request, res: Response) => {
  const doc = documentStore.getById(req.params["id"] as string);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc.versions ?? []);
});

// POST /api/documents/:id/restore/:versionId
router.post("/:id/restore/:versionId", (req: Request, res: Response) => {
  const restored = documentStore.restoreVersion(
    req.params["id"] as string,
    req.params["versionId"] as string
  );
  if (!restored) {
    res.status(404).json({ error: "Document or version not found" });
    return;
  }
  res.json(restored);
});

// DELETE /api/documents/:id
router.delete("/:id", (req: Request, res: Response) => {
  documentStore.delete(req.params["id"] as string);
  res.json({ ok: true });
});

export default router;
