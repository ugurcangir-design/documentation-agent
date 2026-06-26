import { Router, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import { marked } from "marked";
import { chromium } from "playwright";

import { documentStore, type StoredDocument } from "../store/documentStore";
import { exportToWord } from "../../export/wordExporter";

const router = Router();

function getDocs(documentIds: string[]): StoredDocument[] {
  return documentIds
    .map((id) => documentStore.getById(id))
    .filter((d): d is StoredDocument => Boolean(d));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[çÇ]/g, "c").replace(/[şŞ]/g, "s").replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u").replace(/[öÖ]/g, "o").replace(/[ıİ]/g, "i")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildCombinedMarkdown(docs: StoredDocument[], title: string): string {
  const parts: string[] = [`# ${title}\n`, `_${new Date().toLocaleDateString("tr-TR")} tarihinde oluşturuldu_\n`];
  parts.push(`\n## İçindekiler\n`);
  docs.forEach((doc, i) => {
    parts.push(`${i + 1}. [${doc.screenTitle}](#${slugify(doc.screenTitle)})`);
  });
  parts.push("");

  for (const doc of docs) {
    parts.push(`\n---\n\n# ${doc.screenTitle}\n`);
    parts.push(`**URL:** \`${doc.screenPath}\`\n`);
    parts.push(`\n${doc.userManualContent}\n`);
  }
  return parts.join("\n");
}

function buildHtml(docs: StoredDocument[], title: string): string {
  const sections = docs.map((doc) => {
    const userHtml = marked.parse(doc.userManualContent) as string;
    return `
      <section class="page">
        <h1>${escapeHtml(doc.screenTitle)}</h1>
        <p class="meta">URL: <code>${escapeHtml(doc.screenPath)}</code></p>
        <div>${userHtml}</div>
      </section>
    `;
  }).join("\n");

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 20mm 15mm; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; line-height: 1.55; font-size: 11pt; }
    .cover { text-align: center; padding: 100px 0 60px; border-bottom: 2px solid #111; margin-bottom: 40px; page-break-after: always; }
    .cover h1 { font-size: 32pt; margin-bottom: 8px; }
    .cover p { color: #666; font-size: 11pt; }
    .page { page-break-before: always; }
    .page:first-of-type { page-break-before: auto; }
    h1 { font-size: 18pt; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-top: 24px; }
    h2 { font-size: 14pt; margin-top: 22px; color: #1e40af; }
    h3 { font-size: 12pt; margin-top: 18px; color: #374151; }
    p { margin: 8px 0; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 10pt; }
    pre { background: #f3f4f6; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 9.5pt; }
    table { border-collapse: collapse; margin: 10px 0; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 10.5pt; }
    th { background: #f3f4f6; }
    ul, ol { padding-left: 22px; }
    .meta { color: #666; font-size: 10pt; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(title)}</h1>
    <p>${new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}</p>
    <p>${docs.length} ekran · ${docs.length * 2} bölüm</p>
  </div>
  ${sections}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

// ── POST /api/export/docx ──────────────────────────────────────────
router.post("/docx", async (req: Request, res: Response) => {
  const { documentIds, title = "Uygulama Dökümanları" } = req.body as { documentIds: string[]; title?: string };
  if (!documentIds?.length) { res.status(400).json({ error: "documentIds required" }); return; }
  const docs = getDocs(documentIds);
  if (!docs.length) { res.status(404).json({ error: "No documents found" }); return; }

  try {
    const outDir = path.join(process.cwd(), "data", "exports");
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${slugify(title)}-${Date.now()}.docx`;
    const filePath = path.join(outDir, fileName);
    await exportToWord(docs, title, filePath);
    res.download(filePath, fileName, () => fs.unlink(filePath, () => {}));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/export/markdown — single combined .md ───────────────
router.post("/markdown", (req: Request, res: Response) => {
  const { documentIds, title = "Uygulama Dökümanları" } = req.body as { documentIds: string[]; title?: string };
  if (!documentIds?.length) { res.status(400).json({ error: "documentIds required" }); return; }
  const docs = getDocs(documentIds);
  if (!docs.length) { res.status(404).json({ error: "No documents found" }); return; }

  const md = buildCombinedMarkdown(docs, title);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slugify(title)}.md"`);
  res.send(md);
});

// ── POST /api/export/pdf — Playwright HTML→PDF ────────────────────
router.post("/pdf", async (req: Request, res: Response) => {
  const { documentIds, title = "Uygulama Dökümanları" } = req.body as { documentIds: string[]; title?: string };
  if (!documentIds?.length) { res.status(400).json({ error: "documentIds required" }); return; }
  const docs = getDocs(documentIds);
  if (!docs.length) { res.status(404).json({ error: "No documents found" }); return; }

  try {
    const html = buildHtml(docs, title);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${slugify(title)}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/export/zip — bundle: markdowns + screenshots ────────
router.post("/zip", (req: Request, res: Response) => {
  const { documentIds, title = "Uygulama Dökümanları" } = req.body as { documentIds: string[]; title?: string };
  if (!documentIds?.length) { res.status(400).json({ error: "documentIds required" }); return; }
  const docs = getDocs(documentIds);
  if (!docs.length) { res.status(404).json({ error: "No documents found" }); return; }

  try {
    const zip = new AdmZip();
    const shotsDir = path.join(process.cwd(), "data", "screenshots");

    // Combined markdown
    zip.addFile(`${slugify(title)}.md`, Buffer.from(buildCombinedMarkdown(docs, title), "utf-8"));

    // Per-document folders
    for (const doc of docs) {
      const folder = slugify(doc.screenTitle) || "doc";
      zip.addFile(
        `${folder}/kullanici-kilavuzu.md`,
        Buffer.from(`# ${doc.screenTitle} — Kullanıcı Kılavuzu\n\n${doc.userManualContent}`, "utf-8")
      );

      const shotName = path.basename(doc.screenshotPath);
      const shotPath = path.join(shotsDir, shotName);
      if (fs.existsSync(shotPath)) {
        zip.addLocalFile(shotPath, folder);
      }
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${slugify(title)}.zip"`);
    res.send(zip.toBuffer());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
