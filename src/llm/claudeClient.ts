/**
 * Unified Claude client. Routes to either:
 *   - Anthropic SDK (ANTHROPIC_API_KEY)
 *   - `claude` CLI (Claude Code, uses local auth)
 * Choose via env.claudeBackend ('cli' | 'api'). Default: 'cli'.
 */

import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { env } from "../config/env";

/** Resolve `claude` binary even when the parent PATH is sanitized
 *  (e.g. launched from a macOS .app via AppleScript). Tries the
 *  configured bin first, then common install locations. */
function resolveClaudeBin(configured: string): string {
  if (path.isAbsolute(configured) && fs.existsSync(configured)) {
    return configured;
  }
  // Probe PATH explicitly
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = path.join(dir, configured);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallbacks for common install locations Claude Code uses
  const home = os.homedir();
  const fallbacks = [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const f of fallbacks) {
    if (fs.existsSync(f)) return f;
  }
  return configured; // let spawn throw ENOENT with the original name
}

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
  /** Job-stable prefix (örn. rol + output structure + kurallar + şablonlar).
   *  API backend bu bloğu `cache_control: ephemeral` ile işaretler — aynı
   *  job içinde N ekran için aynı prefix tekrar gönderildiğinde Anthropic
   *  cache hit verir (input token maliyeti ~%90 düşer). CLI backend
   *  cache desteklemediği için prompt'a basitçe önceler. Min ~1024 token
   *  olmadığında cache aktive olmaz (Anthropic limiti). */
  cachedPrefix?: string;
  /** Çağrı için kullanılacak Claude modeli. Varsayılan
   *  `claude-sonnet-4-6` (üretim). Ucuz yargı çağrıları için
   *  `claude-haiku-4-5` kullanın. */
  model?: string;
}

export interface ClaudeResult {
  text: string;
  /** Fresh (uncached) input tokens. NOT cache_read/cache_creation —
   *  those are billed at different rates and tracked separately. */
  inputTokens: number;
  outputTokens: number;
  /** Cache'ten okunan input token (ephemeral hit). 0.1× ücretlendirilir. */
  cacheReadTokens?: number;
  /** Cache'e yazılan input token (ilk istek, prefix yaratımı). 1.25×. */
  cacheCreationTokens?: number;
  /** True when model hit max_tokens and output is truncated. Caller
   *  decides whether to surface a warning or retry with a higher cap. */
  truncated?: boolean;
  stopReason?: string;
}

export function isTransientError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  return (
    msg.includes("overload") ||      // 529
    msg.includes("rate limit") ||    // 429
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang") ||
    msg.includes("network") ||
    msg.includes("econnrefused")
  );
}

export function isPromptTooLong(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  return (
    msg.includes("prompt is too long") ||
    msg.includes("prompt too long") ||
    msg.includes("context length") ||
    msg.includes("token limit") ||
    msg.includes("maximum context")
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  const imageCount = (opts.images?.length ?? 0) + (opts.imageBase64 || opts.imagePath ? 1 : 0);
  const promptLen = opts.prompt.length;
  console.log(`[claude] backend=${env.claudeBackend} prompt=${promptLen}c images=${imageCount}`);
  if (process.env.DOCAGENT_DUMP_PROMPT) {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const dir = path.join(process.cwd(), "data", "logs");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `prompt_${Date.now()}.txt`);
    fs.writeFileSync(f, opts.prompt, "utf-8");
    console.log(`[claude] prompt dumped → ${f}`);
  }

  // Retry transient failures with exponential backoff (1s, 4s).
  const maxRetries = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await (env.claudeBackend === "api" ? callApi(opts) : callCli(opts));
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isTransientError(err)) throw err;
      const delay = 1000 * Math.pow(4, attempt);
      console.warn(`[claude] geçici hata, ${delay}ms sonra tekrar (${attempt + 1}/${maxRetries}): ${(err as Error).message}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ── API backend ─────────────────────────────────────────────────
async function callApi(opts: ClaudeCallOptions): Promise<ClaudeResult> {
  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY ayarlı değil. Ayarlar sayfasından girin veya CLI modunu seçin.");
  }

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  // Job-stable prefix — marked for ephemeral caching. Anthropic caches the
  // prefix for ~5 min; subsequent requests with the same prefix pay ~10%
  // input cost on the cached portion. Must come before the per-screen
  // content (cache breakpoint requires stable bytes at the front).
  if (opts.cachedPrefix && opts.cachedPrefix.trim().length > 0) {
    content.push({
      type: "text",
      text: opts.cachedPrefix,
      cache_control: { type: "ephemeral" },
    });
  }

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

  const maxTokens = opts.maxTokens ?? 8000;
  const response = await client.messages.create({
    model: opts.model ?? "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });

  const firstBlock = response.content[0];
  const text = firstBlock?.type === "text" ? firstBlock.text : "";
  const truncated = response.stop_reason === "max_tokens";
  if (truncated) {
    console.warn(
      `[claude] ÇIKTI KESİLDİ: stop_reason=max_tokens (max_tokens=${maxTokens}, ` +
      `output_tokens=${response.usage.output_tokens}). Üretilen doküman yarım kalmış olabilir.`
    );
  }

  // Cache görünürlüğü — kullanıcı tasarrufu görsün.
  const usage = response.usage as Anthropic.Messages.Usage & {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
    console.log(
      `[claude] cache: read=${usage.cache_read_input_tokens ?? 0} create=${usage.cache_creation_input_tokens ?? 0} input=${response.usage.input_tokens}`
    );
  }

  const result: ClaudeResult = {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    truncated,
  };
  if (response.stop_reason) result.stopReason = response.stop_reason;
  return result;
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

  // CLI backend prompt caching desteklemiyor — cachedPrefix'i prompt'un
  // başına ekleyerek aynı metinsel akışı korur (cache kazancı yok).
  let prompt = opts.cachedPrefix && opts.cachedPrefix.trim().length > 0
    ? `${opts.cachedPrefix}\n\n${opts.prompt}`
    : opts.prompt;
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
    if (opts.model) args.push("--model", opts.model);

    const claudeBin = resolveClaudeBin(env.claudeCliBin);
    if (claudeBin !== env.claudeCliBin) {
      console.log(`[claude] CLI resolved: ${env.claudeCliBin} → ${claudeBin}`);
    }
    const proc = spawn(claudeBin, args, {
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
          `Claude CLI bulunamadı (denenen: ${claudeBin}). ` +
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
          stop_reason?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };
        const truncated = parsed.stop_reason === "max_tokens";
        if (truncated) {
          console.warn(
            `[claude] ÇIKTI KESİLDİ (CLI): stop_reason=max_tokens. Üretilen doküman yarım kalmış olabilir.`
          );
        }
        const cliResult: ClaudeResult = {
          text: parsed.result ?? out.trim(),
          inputTokens: parsed.usage?.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? 0,
          cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
          truncated,
        };
        if (parsed.stop_reason) cliResult.stopReason = parsed.stop_reason;
        resolve(cliResult);
      } catch {
        resolve({ text: out.trim(), inputTokens: 0, outputTokens: 0 });
      }
    });
  });
}
