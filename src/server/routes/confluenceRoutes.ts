import { Router, type Request, type Response } from "express";

import { documentStore } from "../store/documentStore";
import {
  publishToConfluence,
  searchConfluencePages,
} from "../../publisher/confluencePublisher";
import type { DocumentationOutput } from "../../types/documentation";

const router = Router();

// GET /api/confluence/pages/search?q=...
router.get("/pages/search", async (req: Request, res: Response) => {
  const q = (req.query["q"] as string) || "";
  try {
    const pages = await searchConfluencePages(q);
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/confluence/publish
// body: { documentIds: string[], mode: 'new' | 'append' | 'child', parentPageId?: string, title?: string }
router.post("/publish", async (req: Request, res: Response) => {
  const {
    documentIds,
    mode,
    parentPageId,
    title,
  } = req.body as {
    documentIds: string[];
    mode: "new" | "append" | "child";
    parentPageId?: string;
    title?: string;
  };

  if (!documentIds?.length) {
    res
      .status(400)
      .json({ error: "documentIds required" });
    return;
  }

  try {
    const docs = documentIds
      .map((id) => documentStore.getById(id))
      .filter(Boolean) as ReturnType<
      typeof documentStore.getById
    >[];

    if (docs.length === 0) {
      res.status(404).json({ error: "No documents found" });
      return;
    }

    const appTitle = title || "Uygulama Dökümanları";

    const userManual = docs
      .map((d) => d!.userManualContent)
      .join("\n\n---\n\n");

    const technicalDoc = docs
      .map((d) => d!.technicalDocContent)
      .join("\n\n---\n\n");

    const output: DocumentationOutput = {
      appTitle,
      userManual,
      technicalDoc,
      screens: docs.map((d) => ({
        screen: {
          url: "",
          path: d!.screenPath,
          title: d!.screenTitle,
          screenshotPath: d!.screenshotPath,
          screenshotBase64: "",
          depth: 0,
        },
        analysis: {
          screenTitle: d!.screenTitle,
          purpose: "",
          uiElements: [],
          workflows: [],
          dataDisplayed: [],
          navigationOptions: [],
        },
        userManualSection: d!.userManualContent,
        technicalDocSection: d!.technicalDocContent,
      })),
      generatedAt: new Date().toISOString(),
    };

    // Override parentPageId from request (env reads process.env lazily)
    if (parentPageId) {
      process.env["CONFLUENCE_PARENT_PAGE_ID"] = parentPageId;
    }

    await publishToConfluence(output, mode);

    // Mark documents as published
    for (const doc of docs) {
      documentStore.update(doc!.id, { status: "published" });
    }

    res.json({ ok: true, count: docs.length });
  } catch (err) {
    res
      .status(500)
      .json({ error: (err as Error).message });
  }
});

export default router;
