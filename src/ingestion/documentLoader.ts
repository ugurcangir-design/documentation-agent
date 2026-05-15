import fs from "fs";
import path from "path";

import {
  DocumentSource,
  DocumentSourceType,
} from "../types/documentSource";

import { normalizeMarkdown } from "../normalization/markdownNormalizer";

export interface LoadDocumentsOptions {
  type: DocumentSourceType;

  directory: string;

  extension?: string;
}

export function loadDocuments(
  options: LoadDocumentsOptions
): DocumentSource[] {
  const {
    type,
    directory,
    extension = ".md",
  } = options;

  const targetDir = path.join(process.cwd(), directory);

  if (!fs.existsSync(targetDir)) {
    throw new Error(
      `Document directory not found: ${targetDir}`
    );
  }

  const files = fs
    .readdirSync(targetDir)
    .filter((file) => file.endsWith(extension));

  return files.map((file) => {
    const fullPath = path.join(targetDir, file);

    const rawContent = fs.readFileSync(
      fullPath,
      "utf-8"
    );

    const normalizedContent =
      normalizeMarkdown(rawContent);

    return {
      id: `${type}-${file}`,

      type,

      fileName: file,

      title: file.replace(extension, ""),

      content: normalizedContent,
    };
  });
}