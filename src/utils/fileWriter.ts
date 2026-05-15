import fs from "fs";
import path from "path";

export function writeOutputFile(
  fileName: string,
  content: string
) {
  const outputDir = path.join(
    process.cwd(),
    "data",
    "output"
  );

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fullPath = path.join(outputDir, fileName);

  fs.writeFileSync(fullPath, content);

  return fullPath;
}