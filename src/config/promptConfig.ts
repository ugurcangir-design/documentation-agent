import fs from "fs";
import path from "path";

interface PromptCfg {
  role?: string;
  outputStructure?: string;
  instructions?: string;
  rules?: string[];
  language?: string;
  maxTokens?: number;
}

const PATH = path.join(process.cwd(), "data", "prompts", "config.json");

export function loadPromptConfig(key: string): PromptCfg {
  if (!fs.existsSync(PATH)) return {};
  const data = JSON.parse(fs.readFileSync(PATH, "utf-8")) as Record<string, PromptCfg>;
  return data[key] ?? {};
}

export function buildPromptHeader(cfg: PromptCfg): string {
  const parts: string[] = [];
  if (cfg.role) parts.push(cfg.role);
  return parts.join("\n");
}

export function buildPromptFooter(cfg: PromptCfg): string {
  const parts: string[] = [];
  if (cfg.outputStructure) {
    parts.push(`Şu yapıyı kullan:\n\n${cfg.outputStructure}`);
  }
  if (cfg.rules && cfg.rules.length > 0) {
    parts.push(`Kurallar:\n${cfg.rules.map((r) => `- ${r}`).join("\n")}`);
  }
  return parts.join("\n\n");
}
