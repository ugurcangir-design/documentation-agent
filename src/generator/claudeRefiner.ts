import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";

export function refineWithClaude(
  contextFilePath: string,
  promptFilePath: string,
  outputFileName: string
) {
  const context = fs.readFileSync(contextFilePath, "utf-8");

  const promptTemplate = fs.readFileSync(
    promptFilePath,
    "utf-8"
  );

  const finalPrompt = promptTemplate.replace(
    "{{CONTEXT}}",
    context
  );

  const outputDir = path.join(
    process.cwd(),
    "data",
    "ai-output"
  );

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, outputFileName);

  console.log("\nRunning Claude CLI...\n");

  const result = spawnSync(
    "claude",
    ["--print"],
    {
      input: finalPrompt,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 20,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error("Claude CLI stderr:");
    console.error(result.stderr);

    console.error("Claude CLI stdout:");
    console.error(result.stdout);

    throw new Error(
      `Claude CLI failed with status ${result.status}`
    );
  }

  const cleanedOutput = cleanGeneratedMarkdown(result.stdout);

  fs.writeFileSync(outputPath, cleanedOutput);

  return outputPath;
}