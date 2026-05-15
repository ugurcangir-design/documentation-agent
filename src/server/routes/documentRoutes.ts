import { Router, type Request, type Response } from "express";

import { documentStore, type DocumentStatus } from "../store/documentStore";

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

// DELETE /api/documents/:id
router.delete("/:id", (req: Request, res: Response) => {
  documentStore.delete(req.params.id as string);
  res.json({ ok: true });
});

export default router;
