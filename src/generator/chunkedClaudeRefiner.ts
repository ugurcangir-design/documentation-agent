import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

import { DOCUMENT_SECTIONS } from "./documentSections";

import { buildSectionPrompt } from "./buildSectionPrompt";

import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";

import {
  createSectionCacheKey,
  getCachedSection,
  saveCachedSection,
} from "./sectionCache";

export function refineDocumentInChunks(
  contextFilePath: string,
  outputFileName: string
) {
  const contextJson = fs.readFileSync(
    contextFilePath,
    "utf-8"
  );

  const generatedSections: string[] = [];

  for (const section of DOCUMENT_SECTIONS) {
    console.log(`\nGenerating section: ${section.title}`);

    const cacheKey = createSectionCacheKey(
      section.id,
      contextJson
    );

    const cached = getCachedSection(cacheKey);

    if (cached) {
      console.log(
        `Using cached section: ${section.title}`
      );

      generatedSections.push(cached);

      continue;
    }

    const prompt = buildSectionPrompt(
      section,
      contextJson
    );

    const result = spawnSync(
      "claude",
      ["--print"],
      {
        input: prompt,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 20,
      }
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      const stdout = result.stdout?.trim();

      console.error("\nClaude section generation failed");
      console.error("Section:", section.title);
      console.error("Status:", result.status);

      if (stderr) {
        console.error("\nClaude stderr:");
        console.error(stderr);
      }

      if (stdout) {
        console.error("\nClaude stdout:");
        console.error(stdout);
      }

      throw new Error(
        [
          `Claude failed while generating section: ${section.title}`,
          stderr ? `stderr: ${stderr}` : "",
          stdout ? `stdout: ${stdout}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    const cleaned = cleanGeneratedMarkdown(
      result.stdout
    );

    generatedSections.push(cleaned);

    saveCachedSection(cacheKey, cleaned);
  }

  const finalDocument =
    generatedSections.join("\n\n");

  const outputDir = path.join(
    process.cwd(),
    "data",
    "ai-output"
  );

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {
      recursive: true,
    });
  }

  const outputPath = path.join(
    outputDir,
    outputFileName
  );

  fs.writeFileSync(
    outputPath,
    finalDocument
  );

  return outputPath;
}