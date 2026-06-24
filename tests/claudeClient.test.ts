import { describe, it, expect } from "vitest";
import { isPromptTooLong, isTransientError } from "../src/llm/claudeClient";

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
