import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// callClaude'u mock'la — gerçek `claude`/npx/Chrome hiç tetiklenmeden
// fetchLiveAppEvidence'ın karar mantığını (opt-in kapalı, backend kısıtı,
// hata → non-fatal null, cache) doğrula.
const callClaudeCalls: Array<{ prompt: string }> = [];
let callClaudeImpl: (opts: { prompt: string }) => Promise<{ text: string; inputTokens: number; outputTokens: number }> =
  async (opts) => { callClaudeCalls.push(opts); return { text: "## Kanıt\n\nGözlem", inputTokens: 1, outputTokens: 1 }; };

vi.mock("../src/llm/claudeClient", () => ({
  callClaude: vi.fn((opts: { prompt: string }) => callClaudeImpl(opts)),
  MODEL_QUALITY: "claude-sonnet-4-6",
  MODEL_FAST: "claude-haiku-4-5",
}));

import { fetchLiveAppEvidence, hashPath } from "../src/browser/liveAppMcp";
import type { DiscoveredScreen } from "../src/types/screen";

function makeScreen(testPath: string): DiscoveredScreen {
  return {
    url: `http://x${testPath}`,
    path: testPath,
    title: "Test Ekran",
    screenshotPath: "/s/x.png",
    screenshotBase64: "X",
    depth: 0,
  };
}

const LIVE_APP_DIR = path.join(process.cwd(), "data", "references", "live-app");

function cacheFilesFor(testPath: string): string[] {
  const hash = hashPath(testPath);
  return [
    path.join(LIVE_APP_DIR, `${hash}.md`),
    path.join(LIVE_APP_DIR, "_index.json"),
  ];
}

function cleanup(testPath: string): void {
  for (const f of cacheFilesFor(testPath)) {
    try { fs.unlinkSync(f); } catch { /* yoksa sorun değil */ }
  }
}

describe("fetchLiveAppEvidence — opt-in ve backend kısıtı", () => {
  const testPath = "/__test__/opt-in";

  beforeEach(() => {
    callClaudeCalls.length = 0;
    delete process.env.LIVE_APP_MCP_ENABLED;
    delete process.env.CLAUDE_BACKEND;
    cleanup(testPath);
  });
  afterEach(() => cleanup(testPath));

  it("LIVE_APP_MCP_ENABLED tanımsız/false iken hemen null döner, callClaude hiç tetiklenmez", async () => {
    const result = await fetchLiveAppEvidence(makeScreen(testPath));
    expect(result).toBeNull();
    expect(callClaudeCalls).toHaveLength(0);
  });

  it("LIVE_APP_MCP_ENABLED=true ama CLAUDE_BACKEND=api iken null döner (yalnız CLI destekli)", async () => {
    process.env.LIVE_APP_MCP_ENABLED = "true";
    process.env.CLAUDE_BACKEND = "api";
    const result = await fetchLiveAppEvidence(makeScreen(testPath));
    expect(result).toBeNull();
    expect(callClaudeCalls).toHaveLength(0);
  });
});

describe("fetchLiveAppEvidence — hata toleransı ve cache", () => {
  const testPath = "/__test__/behavior";

  beforeEach(() => {
    callClaudeCalls.length = 0;
    process.env.LIVE_APP_MCP_ENABLED = "true";
    process.env.CLAUDE_BACKEND = "cli";
    cleanup(testPath);
    callClaudeImpl = async (opts) => { callClaudeCalls.push(opts); return { text: "## Kanıt\n\nGözlem", inputTokens: 1, outputTokens: 1 }; };
  });
  afterEach(() => {
    delete process.env.LIVE_APP_MCP_ENABLED;
    delete process.env.CLAUDE_BACKEND;
    cleanup(testPath);
  });

  it("callClaude hata fırlatırsa null döner (fatal DEĞİL — pipeline'ı bozmaz)", async () => {
    callClaudeImpl = async () => { throw new Error("claude CLI zaman aşımı"); };
    const result = await fetchLiveAppEvidence(makeScreen(testPath));
    expect(result).toBeNull();
  });

  it("başarılı çağrı sonucu cache'lenir; ikinci çağrıda callClaude TEKRAR tetiklenmez", async () => {
    const first = await fetchLiveAppEvidence(makeScreen(testPath));
    expect(first).toContain("Gözlem");
    expect(callClaudeCalls).toHaveLength(1);

    const second = await fetchLiveAppEvidence(makeScreen(testPath));
    expect(second).toBe(first);
    expect(callClaudeCalls).toHaveLength(1); // ikinci çağrı cache'ten okundu
  });
});
