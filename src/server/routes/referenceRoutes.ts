import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

import { referenceStore } from "../store/referenceStore";
import { env } from "../../config/env";
import {
  getValidAccessToken,
  getStoredTokens,
  getConfluenceApiBase,
} from "../auth/atlassianAuth";

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
    res.status(400).json({ error: "url gerekli" });
    return;
  }

  // Determine auth: OAuth tokens preferred, fall back to API token
  const tokens = getStoredTokens();
  const hasLegacy = env.confluenceBaseUrl && env.confluenceEmail && env.confluenceApiToken;

  if (!tokens && !hasLegacy) {
    res.status(400).json({
      error: "Confluence bağlantısı yok. Ayarlar'dan Atlassian OAuth ile bağlanın.",
    });
    return;
  }

  try {
    let apiBase: string;
    let authHeader: string;

    if (tokens) {
      const { accessToken, cloudId } = await getValidAccessToken();
      apiBase = `${getConfluenceApiBase(cloudId)}/wiki/rest/api`;
      authHeader = `Bearer ${accessToken}`;
    } else {
      apiBase = `${env.confluenceBaseUrl.replace(/\/$/, "")}/wiki/rest/api`;
      authHeader =
        "Basic " + Buffer.from(`${env.confluenceEmail}:${env.confluenceApiToken}`).toString("base64");
    }

    // Extract page ID from URL
    const idMatch = url.match(/\/pages\/(\d+)/);
    const pageId = idMatch?.[1] ?? "";
    if (!pageId) {
      res.status(400).json({ error: "URL'den sayfa ID çıkarılamadı. '/pages/12345' formatında bir URL girin." });
      return;
    }

    const apiUrl = `${apiBase}/content/${pageId}?expand=body.storage,space,version`;
    const pageResp = await new Promise<string>((resolve, reject) => {
      const parsed = new URL(apiUrl);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers: { Authorization: authHeader, Accept: "application/json" },
      };
      const client = parsed.protocol === "https:" ? https : http;
      client.get(options, (res2) => {
        let d = "";
        res2.on("data", (chunk: Buffer) => { d += chunk.toString(); });
        res2.on("end", () => resolve(d));
        res2.on("error", reject);
      }).on("error", reject);
    });

    const page = JSON.parse(pageResp) as {
      id?: string;
      title?: string;
      space?: { key?: string };
      body?: { storage?: { value?: string } };
      message?: string;
    };

    if (!page.id) {
      res.status(400).json({ error: page.message ?? "Sayfa bulunamadı veya erişim yok." });
      return;
    }

    const htmlContent = page.body?.storage?.value ?? "";
    const plainText = htmlContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const dir = path.join(REFS_DIR, "confluence");
    fs.mkdirSync(dir, { recursive: true });
    const contentFile = path.join(dir, `${page.id}.txt`);
    fs.writeFileSync(contentFile, plainText, "utf-8");

    const ref = referenceStore.addConfluence({
      url,
      pageId: page.id,
      title: page.title ?? "(başlıksız)",
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
function fetchWithRedirects(
  url: string,
  authorization?: string,
  maxRedirects = 3
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers: Record<string, string> = { Accept: "application/json,text/plain,*/*" };
    if (authorization) headers["Authorization"] = authorization;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      headers,
    };
    const client = parsed.protocol === "https:" ? https : http;
    client.get(options, (response) => {
      const status = response.statusCode ?? 0;
      const ct = (response.headers["content-type"] as string) ?? "";

      if (status >= 300 && status < 400 && response.headers.location && maxRedirects > 0) {
        const next = new URL(response.headers.location as string, url).toString();
        response.resume();
        fetchWithRedirects(next, authorization, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      let d = "";
      response.on("data", (chunk: Buffer) => { d += chunk.toString(); });
      response.on("end", () => resolve({ status, body: d, contentType: ct }));
      response.on("error", reject);
    }).on("error", reject);
  });
}

router.post("/swagger/fetch", async (req: Request, res: Response) => {
  const { url, name, authorization } = req.body as {
    url?: string;
    name?: string;
    authorization?: string;
  };

  if (!url) {
    res.status(400).json({ error: "url gerekli" });
    return;
  }

  try {
    const { status, body, contentType } = await fetchWithRedirects(
      url,
      authorization?.trim() || undefined
    );

    if (status === 401 || status === 403) {
      res.status(400).json({
        error: `Yetkisiz erişim (HTTP ${status}). Authorization header'ı kontrol edin.`,
      });
      return;
    }

    if (status >= 400) {
      res.status(400).json({ error: `Sunucu HTTP ${status} döndürdü.` });
      return;
    }

    const trimmed = body.trim();
    const looksLikeHtml = trimmed.startsWith("<") || contentType.includes("text/html");

    if (looksLikeHtml) {
      res.status(400).json({
        error:
          "Sunucu JSON yerine HTML döndürdü. Genellikle giriş gerektirir — Authorization (Bearer token) ekleyin veya açık erişimli swagger URL'sini kullanın.",
      });
      return;
    }

    let spec: { info?: { title?: string }; paths?: Record<string, unknown> };
    try {
      spec = JSON.parse(body) as typeof spec;
    } catch {
      res.status(400).json({
        error: `Yanıt JSON olarak ayrıştırılamadı. Content-Type: ${contentType || "yok"}. İlk 200 karakter: ${body.slice(0, 200)}`,
      });
      return;
    }

    const endpointCount = Object.keys(spec.paths ?? {}).length;
    const specName = name?.trim() || spec.info?.title || new URL(url).hostname;

    const dir = path.join(process.cwd(), "data", "swagger");
    fs.mkdirSync(dir, { recursive: true });
    const specFile = path.join(dir, `${Date.now()}.json`);
    fs.writeFileSync(specFile, body, "utf-8");

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
