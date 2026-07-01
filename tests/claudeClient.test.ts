import { describe, it, expect } from "vitest";
import { isPromptTooLong, isTransientError, friendlyCliError, isUsageLimitError } from "../src/llm/claudeClient";

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
