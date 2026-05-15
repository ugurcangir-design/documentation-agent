import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

import { referenceStore } from "../store/referenceStore";
import { env } from "../../config/env";

const router = Router();

const REFS_DIR = path.join(process.cwd(), "data", "references");
const upload = multer({ dest: path.join(REFS_DIR, "_tmp") });

// ── Helpers ──────────────────────────────────────────────────────
function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ── GET /api/references ─────────────────────────────────────────
router.get("/", (_req: Request, res: Response) => {
  res.json(referenceStore.getAll());
});

// ── Confluence: fetch a page by URL ─────────────────────────────
router.post("/confluence/fetch", async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url) {
    res.status(400).json({ error: "url required" });
    return;
  }

  if (!env.confluenceBaseUrl || !env.confluenceEmail || !env.confluenceApiToken) {
    res.status(400).json({ error: "Confluence credentials not configured in Settings" });
    return;
  }

  try {
    // Extract page ID from URL (works for both /wiki/spaces/... and /pages/12345)
    let pageId = "";
    const idMatch = url.match(/\/pages\/(\d+)/);
    if (idMatch) {
      pageId = idMatch[1] ?? "";
    } else {
      // Try to search by title if it's a named URL
      const titleMatch = url.match(/\/([^/]+)$/);
      const title = titleMatch ? decodeURIComponent(titleMatch[1] ?? "").replace(/\+/g, " ") : "";
      const searchUrl = `${env.confluenceBaseUrl}/rest/api/content?title=${encodeURIComponent(title)}&expand=body.storage&limit=1`;
      const auth = Buffer.from(`${env.confluenceEmail}:${env.confluenceApiToken}`).toString("base64");
      const searchResp = await fetchUrl(searchUrl + `&Authorization=Basic ${auth}`);
      const searchData = JSON.parse(searchResp) as { results?: Array<{ id: string }> };
      pageId = searchData.results?.[0]?.id ?? "";
    }

    if (!pageId) {
      res.status(400).json({ error: "Could not extract page ID from URL" });
      return;
    }

    // Fetch page from Confluence API
    const apiUrl = `${env.confluenceBaseUrl}/rest/api/content/${pageId}?expand=body.storage,space,version`;
    const auth = Buffer.from(`${env.confluenceEmail}:${env.confluenceApiToken}`).toString("base64");

    const rawResp = await fetchUrl(apiUrl);
    // Re-fetch with auth header via axios pattern using native http
    const pageResp = await new Promise<string>((resolve, reject) => {
      const parsed = new URL(apiUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      };
      const client = parsed.protocol === "https:" ? https : http;
      client.get(options, (res) => {
        let d = "";
        res.on("data", (chunk: Buffer) => { d += chunk.toString(); });
        res.on("end", () => resolve(d));
        res.on("error", reject);
      }).on("error", reject);
    });

    const page = JSON.parse(pageResp) as {
      id: string;
      title: string;
      space: { key: string };
      body: { storage: { value: string } };
    };

    // Strip HTML tags to get plain text
    const htmlContent = page.body?.storage?.value ?? "";
    const plainText = htmlContent
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Save to file
    const dir = path.join(REFS_DIR, "confluence");
    fs.mkdirSync(dir, { recursive: true });
    const contentFile = path.join(dir, `${page.id}.txt`);
    fs.writeFileSync(contentFile, plainText, "utf-8");

    const ref = referenceStore.addConfluence({
      url,
      pageId: page.id,
      title: page.title,
      spaceKey: page.space?.key ?? "",
      contentFile,
      syncedAt: new Date().toISOString(),
      wordCount: plainText.split(/\s+/).length,
    });

    res.json(ref);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Confluence: delete ───────────────────────────────────────────
router.delete("/confluence/:id", (req: Request, res: Response) => {
  referenceStore.removeConfluence(req.params["id"] as string);
  res.json({ ok: true });
});

// ── Swagger: fetch spec from URL ─────────────────────────────────
router.post("/swagger/fetch", async (req: Request, res: Response) => {
  const { url, name } = req.body as { url?: string; name?: string };

  if (!url) {
    res.status(400).json({ error: "url required" });
    return;
  }

  try {
    const rawText = await new Promise<string>((resolve, reject) => {
      const parsed = new URL(url);
      const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search };
      const client = parsed.protocol === "https:" ? https : http;
      client.get(options, (res) => {
        let d = "";
        res.on("data", (chunk: Buffer) => { d += chunk.toString(); });
        res.on("end", () => resolve(d));
        res.on("error", reject);
      }).on("error", reject);
    });

    const spec = JSON.parse(rawText) as {
      info?: { title?: string };
      paths?: Record<string, unknown>;
    };

    const endpointCount = Object.keys(spec.paths ?? {}).length;
    const specName = name || spec.info?.title || new URL(url).hostname;

    const dir = path.join(process.cwd(), "data", "swagger");
    fs.mkdirSync(dir, { recursive: true });
    const specFile = path.join(dir, `${Date.now()}.json`);
    fs.writeFileSync(specFile, rawText, "utf-8");

    const ref = referenceStore.addSwagger({
      url,
      name: specName,
      fetchedAt: new Date().toISOString(),
      endpointCount,
      specFile,
    });

    res.json(ref);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Swagger: delete ──────────────────────────────────────────────
router.delete("/swagger/:id", (req: Request, res: Response) => {
  referenceStore.removeSwagger(req.params["id"] as string);
  res.json({ ok: true });
});

// ── Documents: upload (Word .docx / plain text) ──────────────────
router.post(
  "/documents/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "file required" });
      return;
    }

    const { type = "reference", company = "", description = "" } = req.body as {
      type?: "brd" | "reference" | "template";
      company?: string;
      description?: string;
    };

    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();

    let plainText = "";

    try {
      if (ext === ".docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ path: req.file.path });
        plainText = result.value;
      } else if (ext === ".pdf") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
        const buf = fs.readFileSync(req.file.path);
        const data = await pdfParse(buf);
        plainText = data.text;
      } else if (ext === ".txt" || ext === ".md") {
        plainText = fs.readFileSync(req.file.path, "utf-8");
      } else {
        plainText = fs.readFileSync(req.file.path, "utf-8");
      }
    } catch (err) {
      plainText = `[${originalName} içeriği okunamadı: ${(err as Error).message}]`;
    }

    // Save extracted text
    const dir = path.join(REFS_DIR, type === "template" ? "templates" : "documents");
    fs.mkdirSync(dir, { recursive: true });
    const contentFile = path.join(dir, `${Date.now()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}.txt`);
    fs.writeFileSync(contentFile, plainText, "utf-8");

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    const ref = referenceStore.addDocument({
      filename: path.basename(contentFile),
      originalName,
      type,
      company,
      description,
      uploadedAt: new Date().toISOString(),
      contentFile,
      wordCount: plainText.split(/\s+/).length,
    });

    res.json(ref);
  }
);

// ── Documents: get content ───────────────────────────────────────
router.get("/documents/:id/content", (req: Request, res: Response) => {
  const content = referenceStore.getDocumentContent(req.params["id"] as string);
  if (content === null) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ content });
});

// ── Documents: delete ────────────────────────────────────────────
router.delete("/documents/:id", (req: Request, res: Response) => {
  referenceStore.removeDocument(req.params["id"] as string);
  res.json({ ok: true });
});

export default router;
