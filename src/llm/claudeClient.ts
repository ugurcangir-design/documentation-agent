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

export interface ClaudeCallOptions {
  prompt: string;
  imageBase64?: string;
  imagePath?: string;
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

  let b64 = opts.imageBase64;
  if (!b64 && opts.imagePath && fs.existsSync(opts.imagePath)) {
    b64 = fs.readFileSync(opts.imagePath).toString("base64");
  }
  if (b64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: b64 },
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
  let imagePath = opts.imagePath ? path.resolve(opts.imagePath) : undefined;
  let tempImage = false;

  // If we got base64 but no path, persist it temporarily so the CLI can Read it.
  if (!imagePath && opts.imageBase64) {
    imagePath = path.join("/tmp", `docagent-${Date.now()}.png`);
    fs.writeFileSync(imagePath, Buffer.from(opts.imageBase64, "base64"));
    tempImage = true;
  }

  let prompt = opts.prompt;
  if (imagePath) {
    prompt = `Aşağıdaki dosya yolundaki görüntüyü Read tool ile oku ve analiz et: ${imagePath}\n\n${prompt}`;
  }

  return new Promise<ClaudeResult>((resolve, reject) => {
    const args = ["--print", "--output-format", "json"];
    if (imagePath) args.push("--allowed-tools", "Read");
    args.push(prompt);

    const proc = spawn(env.claudeCliBin, args, {
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let out = "";
    let err = "";

    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { err += d.toString(); });

    proc.on("error", (e) => {
      if (tempImage && imagePath) fs.unlink(imagePath, () => {});
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
      if (tempImage && imagePath) fs.unlink(imagePath, () => {});

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
