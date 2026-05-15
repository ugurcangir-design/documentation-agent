import { Router, type Request, type Response } from "express";
import axios from "axios";

import { env } from "../../config/env";
import { documentStore } from "../store/documentStore";
import {
  publishToConfluence,
} from "../../publisher/confluencePublisher";
import type { DocumentationOutput } from "../../types/documentation";

const router = Router();

// GET /api/confluence/pages/search?q=...
router.get("/pages/search", async (req: Request, res: Response) => {
  const q = (req.query["q"] as string) || "";

  if (!env.confluenceBaseUrl || !env.confluenceSpaceKey) {
    res
      .status(400)
      .json({ error: "Confluence not configured" });
    return;
  }

  try {
    const baseUrl = env.confluenceBaseUrl.replace(/\/$/, "");
    const token = Buffer.from(
      `${env.confluenceEmail}:${env.confluenceApiToken}`
    ).toString("base64");

    const apiUrl = `${baseUrl}/wiki/rest/api/content?type=page&spaceKey=${env.confluenceSpaceKey}&title=${encodeURIComponent(q)}&expand=version&limit=20`;

    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
    });

    const pages = (
      response.data.results as Array<{
        id: string;
        title: string;
        _links: { webui: string };
      }>
    ).map((p) => ({
      id: p.id,
      title: p.title,
      url: `${baseUrl}${p._links.webui}`,
    }));

    res.json(pages);
  } catch (err) {
    res
      .status(500)
      .json({ error: (err as Error).message });
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

    // Override parentPageId from request
    if (parentPageId) {
      env.confluenceParentPageId = parentPageId;
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
