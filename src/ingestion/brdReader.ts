import fs from "fs";
import path from "path";

import { normalizeMarkdown } from "../normalization/markdownNormalizer";

export interface BrdDocument {
  fileName: string;
  content: string;
}

export function readBrdFiles(): BrdDocument[] {
  const brdDir = path.join(process.cwd(), "data", "brd");

  if (!fs.existsSync(brdDir)) {
    throw new Error(`BRD klasörü bulunamadı: ${brdDir}`);
  }

  const files = fs
    .readdirSync(brdDir)
    .filter((file) => file.endsWith(".md"));

  return files.map((file) => {
    const fullPath = path.join(brdDir, file);

    const rawContent = fs.readFileSync(fullPath, "utf-8");

    const normalizedContent = normalizeMarkdown(rawContent);

    return {
      fileName: file,
      content: normalizedContent,
    };
  });
}