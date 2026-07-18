import { describe, it, expect, vi, beforeEach } from "vitest";

// callClaude mock — styleLint'in guardrail mantığını gerçek model olmadan test et.
let mockResponse: string | Error = "";
const calls: Array<{ prompt: string; model?: string }> = [];
vi.mock("../src/llm/claudeClient", () => ({
  callClaude: vi.fn(async (opts: { prompt: string; model?: string }) => {
    calls.push(opts);
    if (mockResponse instanceof Error) throw mockResponse;
    return { text: mockResponse, inputTokens: 5, outputTokens: 5 };
  }),
  MODEL_QUALITY: "claude-sonnet-4-6",
  MODEL_FAST: "claude-haiku-4-5",
}));

import { runStyleLint } from "../src/quality/styleLint";

// ~800 karakterlik gerçekçi bölüm (200 char eşiğinin üstünde).
const SECTION =
  "## Market Sekmesi\n\n" +
  "Bu sekmede market kategorileri listelenir. Yeni kayıt eklemek için Ekle butonuna tıklayın.\n\n" +
  "1. Ekle butonuna tıklayın\n2. Açılan formda Ad alanını doldurun\n3. Kaydet'e basın\n\n" +
  "![Ekran](/screenshots/market.png)\n\n" +
  "Tabloda her satırın sağındaki düzenle ikonu ile kayıt güncellenir. ".repeat(6);

describe("runStyleLint — guardrail'li biçimsel düzeltme", () => {
  beforeEach(() => { calls.length = 0; mockResponse = ""; });

  it("geçerli düzeltme uygulanır (uzunluk ±%15 içinde, görsel sayısı aynı)", async () => {
    mockResponse = SECTION.replace("Ekle butonuna", "**Ekle** butonuna");
    const r = await runStyleLint([SECTION]);
    expect(r.sections[0]).toContain("**Ekle**");
    expect(r.changed).toBe(1);
    expect(calls[0]!.model).toBe("claude-haiku-4-5"); // ucuz model
  });

  it("görsel embed sayısı değişirse çıktı REDDEDİLİR — orijinal korunur", async () => {
    mockResponse = SECTION.replace("![Ekran](/screenshots/market.png)", ""); // görseli düşürdü
    const r = await runStyleLint([SECTION]);
    expect(r.sections[0]).toBe(SECTION); // reddedildi
    expect(r.changed).toBe(0);
  });

  it("uzunluk %15'ten fazla saparsa REDDEDİLİR (içerik kaybı/şişmesi)", async () => {
    mockResponse = SECTION.slice(0, Math.floor(SECTION.length * 0.5)); // yarıya düşürdü
    const r = await runStyleLint([SECTION]);
    expect(r.sections[0]).toBe(SECTION);
    expect(r.changed).toBe(0);
  });

  it("kısa bölüm (<200 char) hiç modele gönderilmez", async () => {
    const short = "## Kısa\n\nTek satır.";
    const r = await runStyleLint([short]);
    expect(r.sections[0]).toBe(short);
    expect(calls).toHaveLength(0);
  });

  it("model hatası fatal değil — orijinal korunur, diğer bölümler işlenir", async () => {
    mockResponse = new Error("timeout");
    const r = await runStyleLint([SECTION, SECTION]);
    expect(r.sections).toEqual([SECTION, SECTION]);
    expect(r.changed).toBe(0);
  });
});
