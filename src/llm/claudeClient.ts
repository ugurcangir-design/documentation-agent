/**
 * Unified Claude client. Routes to either:
 *   - Anthropic SDK (ANTHROPIC_API_KEY)
 *   - `claude` CLI (Claude Code, uses local auth)
 * Choose via env.claudeBackend ('cli' | 'api'). Default: 'cli'.
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

export interface ClaudeImage {
  base64?: string;
  path?: string;
  label?: string;
}

export interface ClaudeCallOptions {
  prompt: string;
  imageBase64?: string;
  imagePath?: string;
  /** Multiple images (state captures). Each is shown to the model
   *  with its label as a preceding text block. */
  images?: ClaudeImage[];
  maxTokens?: number;
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  return env.claudeBackend === "api" ? callApi(opts) : callCli(opts);
}

// ── API backend ─────────────────────────────────────────────────
async function callApi(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY ayarlı değil. Ayarlar sayfasından girin veya CLI modunu seçin.");
  }

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  // Primary image (backwards-compat single-image API)
  let b64 = opts.imageBase64;
  if (!b64 && opts.imagePath && fs.existsSync(opts.imagePath)) {
    b64 = fs.readFileSync(opts.imagePath).toString("base64");
  }
  if (b64) {
    content.push({ type: "text", text: "[Ana ekran görüntüsü]" });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: b64 },
    });
  }

  // Additional state images
  for (const img of opts.images ?? []) {
    let data = img.base64;
    if (!data && img.path && fs.existsSync(img.path)) {
      data = fs.readFileSync(img.path).toString("base64");
    }
    if (!data) continue;
    if (img.label) {
      content.push({ type: "text", text: `[${img.label}]` });
    }
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data },
    });
  }

  content.push({ type: "text", text: opts.prompt });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 3000,
    messages: [{ role: "user", content }],
  });

  const firstBlock = response.content[0];
  const text = firstBlock?.type === "text" ? firstBlock.text : "";

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── CLI backend ─────────────────────────────────────────────────
async function callCli(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  const tempFiles: string[] = [];
  const imagePaths: Array<{ label: string; path: string }> = [];

  // Primary image
  let primary = opts.imagePath ? path.resolve(opts.imagePath) : undefined;
  if (!primary && opts.imageBase64) {
    primary = path.join("/tmp", `docagent-${Date.now()}-main.png`);
    fs.writeFileSync(primary, Buffer.from(opts.imageBase64, "base64"));
    tempFiles.push(primary);
  }
  if (primary) imagePaths.push({ label: "Ana ekran", path: primary });

  // State images
  for (const img of opts.images ?? []) {
    let p = img.path ? path.resolve(img.path) : undefined;
    if (!p && img.base64) {
      p = path.join("/tmp", `docagent-${Date.now()}-${imagePaths.length}.png`);
      fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
      tempFiles.push(p);
    }
    if (p) imagePaths.push({ label: img.label ?? "State", path: p });
  }

  let prompt = opts.prompt;
  if (imagePaths.length > 0) {
    const list = imagePaths.map((i, idx) => `${idx + 1}. [${i.label}] ${i.path}`).join("\n");
    prompt =
      `Aşağıdaki görüntüleri sırayla Read tool ile oku ve hepsini birlikte analiz et:\n${list}\n\n${prompt}`;
  }

  return new Promise<ClaudeResult>((resolve, reject) => {
    // Pass the prompt as the value of --print (positional doesn't work
    // when stdin is closed; CLI requires the prompt as an argument).
    const args = ["--print", prompt, "--output-format", "json"];
    if (imagePaths.length > 0) args.push("--allowed-tools", "Read");

    const proc = spawn(env.claudeCliBin, args, {
      env: { ...process.env, FORCE_COLOR: "0" },
      // Explicitly: no stdin, pipe stdout/stderr. Otherwise the CLI waits
      // 3s for stdin data and exits with a non-zero warning.
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });

    proc.on("error", (e) => {
      for (const f of tempFiles) fs.unlink(f, () => {});
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(new Error(
          `Claude CLI bulunamadı (${env.claudeCliBin}). ` +
          `Kurulum: npm install -g @anthropic-ai/claude-code — veya Ayarlar'dan API moduna geçin.`
        ));
        return;
      }
      reject(e);
    });

    proc.on("exit", (code) => {
      for (const f of tempFiles) fs.unlink(f, () => {});

      if (code !== 0) {
        reject(new Error(err.trim() || `claude CLI exit ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(out) as {
          result?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        resolve({
          text: parsed.result ?? out.trim(),
          inputTokens: parsed.usage?.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? 0,
        });
      } catch {
        resolve({ text: out.trim(), inputTokens: 0, outputTokens: 0 });
      }
    });
  });
}
