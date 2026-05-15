import { Router, type Request, type Response } from "express";
import path from "path";
import fs from "fs";

import { documentStore } from "../store/documentStore";
import { exportToWord } from "../../export/wordExporter";

const router = Router();

// POST /api/export/docx
// body: { documentIds: string[], title?: string }
router.post("/docx", async (req: Request, res: Response) => {
  const {
    documentIds,
    title = "Uygulama Dökümanları",
  } = req.body as {
    documentIds: string[];
    title?: string;
  };

  if (!documentIds?.length) {
    res.status(400).json({ error: "documentIds required" });
    return;
  }

  const docs = documentIds
    .map((id) => documentStore.getById(id))
    .filter(Boolean) as ReturnType<
    typeof documentStore.getById
  >[];

  if (docs.length === 0) {
    res.status(404).json({ error: "No documents found" });
    return;
  }

  try {
    const outputDir = path.join(
      process.cwd(),
      "data",
      "exports"
    );

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const fileName = `${slugify(title)}-${Date.now()}.docx`;
    const filePath = path.join(outputDir, fileName);

    await exportToWord(docs as NonNullable<ReturnType<typeof documentStore.getById>>[], title, filePath);

    res.download(filePath, fileName, () => {
      // Clean up temp file after download
      fs.unlink(filePath, () => {});
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: (err as Error).message });
  }
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[çÇ]/g, "c")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[ıİ]/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default router;
