import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// child_process.spawn'ı mock'la — gerçek `claude` süreci başlatmadan CLI
// çağrı argümanlarını (özellikle --mcp-config/--allowedTools) doğrula.
const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
vi.mock("child_process", () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    // Bir sonraki tick'te başarılı JSON yanıtla çık — gerçek CLI I/O'sunu simüle eder.
    setImmediate(() => {
      proc.stdout.emit("data", Buffer.from(JSON.stringify({ result: "ok", usage: { input_tokens: 1, output_tokens: 1 } })));
      proc.emit("exit", 0);
    });
    return proc;
  }),
}));

import { isPromptTooLong, isTransientError, friendlyCliError, isUsageLimitError, MODEL_QUALITY, MODEL_FAST, callClaude } from "../src/llm/claudeClient";

describe("model sabitleri", () => {
  // Regresyon: bu değerler yanlışlıkla değişirse tüm üretim görevleri
  // (CLI backend'de) kullanıcının kişisel `/model` ayarına sessizce döner.
  it("MODEL_QUALITY ve MODEL_FAST beklenen model kimlikleridir", () => {
    expect(MODEL_QUALITY).toBe("claude-sonnet-4-6");
    expect(MODEL_FAST).toBe("claude-haiku-4-5");
    expect(MODEL_QUALITY).not.toBe(MODEL_FAST);
  });
});

describe("isUsageLimitError", () => {
  it("abonelik/kullanım limiti hatalarını yakalar", () => {
    for (const m of [
      "You've hit your weekly limit · resets 7am",
      "usage limit reached",
      "Claude kullanım limiti doldu",
      "insufficient_quota",
      "billing hard limit reached",
    ]) {
      expect(isUsageLimitError(new Error(m))).toBe(true);
    }
  });
  it("normal hataları limit sanmaz", () => {
    expect(isUsageLimitError(new Error("prompt is too long"))).toBe(false);
    expect(isUsageLimitError(new Error("network error"))).toBe(false);
    expect(isUsageLimitError(undefined)).toBe(false);
  });
});

describe("isPromptTooLong", () => {
  it("yaygın 'prompt too long' varyasyonlarını yakalar", () => {
    for (const m of [
      "prompt is too long: 250000 tokens",
      "Prompt too long",
      "context length exceeded",
      "token limit reached",
      "maximum context window",
    ]) {
      expect(isPromptTooLong(new Error(m))).toBe(true);
    }
  });

  it("ilgisiz hatalarda false döner", () => {
    expect(isPromptTooLong(new Error("ECONNRESET"))).toBe(false);
    expect(isPromptTooLong(undefined)).toBe(false);
    expect(isPromptTooLong(null)).toBe(false);
  });
});

describe("isTransientError", () => {
  it("geçici ağ/aşırı yük hatalarını yakalar", () => {
    for (const m of [
      "Overloaded (529)",
      "rate limit exceeded (429)",
      "request timeout",
      "read ECONNRESET",
      "connect ETIMEDOUT",
      "socket hang up",
      "network error",
    ]) {
      expect(isTransientError(new Error(m))).toBe(true);
    }
  });

  // Regresyon: 'econnrefused' eskiden 'ecconnrefused' (çift c) yazılmıştı,
  // bu yüzden bağlantı-reddi hataları hiç retry edilmiyordu.
  it("ECONNREFUSED'i geçici sayar (typo regresyon koruması)", () => {
    expect(isTransientError(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe(true);
  });

  it("kalıcı hatalarda false döner", () => {
    expect(isTransientError(new Error("invalid api key"))).toBe(false);
    expect(isTransientError(new Error("prompt is too long"))).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe("friendlyCliError", () => {
  it("401 auth hatasını stdout JSON'dan çıkarıp eyleme dönük ipucu verir", () => {
    const out = JSON.stringify({
      is_error: true,
      api_error_status: 401,
      result: "Failed to authenticate. API Error: 401 Invalid authentication credentials",
    });
    const msg = friendlyCliError(out, "", 1);
    expect(msg).toMatch(/kimlik doğrulama/i);
    expect(msg).toMatch(/login|API moduna/i);
    expect(msg).toContain("Failed to authenticate");
  });

  it("auth dışı JSON hatasında result mesajını yüzeye çıkarır", () => {
    const out = JSON.stringify({ is_error: true, result: "Something broke" });
    expect(friendlyCliError(out, "", 1)).toBe("Something broke");
  });

  it("JSON yoksa stderr'a, o da yoksa jenerik exit mesajına düşer", () => {
    expect(friendlyCliError("not-json", "boom from stderr", 1)).toBe("boom from stderr");
    expect(friendlyCliError("not-json", "", 2)).toBe("claude CLI exit 2");
  });

  it("'authenticate' metnini api_error_status olmadan da yakalar", () => {
    expect(friendlyCliError(JSON.stringify({ result: "Unauthorized request" }), "", 1)).toMatch(/kimlik doğrulama/i);
  });
});

describe("callClaude (CLI backend) — MCP spawn argümanları", () => {
  beforeEach(() => { spawnCalls.length = 0; });

  it("mcpConfigPath + allowedTools verilirse --mcp-config/--strict-mcp-config/--allowedTools eklenir", async () => {
    await callClaude({
      prompt: "test",
      mcpConfigPath: "/tmp/.mcp.live-app.json",
      allowedTools: ["mcp__playwright__browser_navigate", "mcp__playwright__browser_click"],
    });
    expect(spawnCalls).toHaveLength(1);
    const args = spawnCalls[0]!.args;
    expect(args).toContain("--mcp-config");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/.mcp.live-app.json");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--allowedTools");
    // Tool adları AYRI argümanlar olmalı (virgüllü tek string DEĞİL) — kanıtlanmış format.
    const toolsIdx = args.indexOf("--allowedTools");
    expect(args[toolsIdx + 1]).toBe("mcp__playwright__browser_navigate");
    expect(args[toolsIdx + 2]).toBe("mcp__playwright__browser_click");
  });

  it("mcpConfigPath/allowedTools verilmezse hiçbir MCP argümanı eklenmez", async () => {
    await callClaude({ prompt: "test" });
    const args = spawnCalls[0]!.args;
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--allowedTools");
  });
});
