import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

const router = Router();
const CONFIG_PATH = path.join(process.cwd(), "data", "prompts", "config.json");

function readConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
}

// GET /api/prompts
router.get("/", (_req: Request, res: Response) => {
  res.json(readConfig());
});

// PUT /api/prompts/:key  — update one prompt block
router.put("/:key", (req: Request, res: Response) => {
  const key = req.params["key"] as string;
  const config = readConfig();

  if (!config[key]) {
    res.status(404).json({ error: `Prompt key not found: ${key}` });
    return;
  }

  config[key] = { ...(config[key] as object), ...(req.body as object) };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  res.json({ ok: true, prompt: config[key] });
});

export default router;
