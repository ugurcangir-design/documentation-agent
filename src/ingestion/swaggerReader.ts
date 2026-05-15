import fs from "fs";
import path from "path";

export function readSwaggerFiles() {
  const swaggerDir = path.join(process.cwd(), "data", "swagger");

  if (!fs.existsSync(swaggerDir)) {
    throw new Error(`Swagger klasörü bulunamadı: ${swaggerDir}`);
  }

  const files = fs
    .readdirSync(swaggerDir)
    .filter((file) => file.endsWith(".json"));

  return files.map((file) => {
    const fullPath = path.join(swaggerDir, file);
    const rawContent = fs.readFileSync(fullPath, "utf-8");
    const json = JSON.parse(rawContent);

    return {
      fileName: file,
      content: json,
    };
  });
}