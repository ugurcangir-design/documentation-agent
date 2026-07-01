import { describe, it, expect, vi } from "vitest";

// Sekme üretiminde kullanım limiti hatası → generateUserManualComplete YARIM
// doküman döndürmemeli, TEMİZ fırlatmalı (screenProcessor ekranı 'failed'
// yapar → kullanıcı bilir + 'Eksikleri Üret' ile tamamlar).
vi.mock("../src/llm/claudeClient", () => ({
  callClaude: vi.fn(async (opts: { prompt: string }) => {
    // Sekme çağrısı (Aktif Sekme) → limit hatası; genel bakış başarılı.
    if (/\*\*Aktif Sekme:\*\*/.test(opts.prompt)) {
      throw new Error("You've hit your weekly limit · resets 7am (Europe/Istanbul)");
    }
    return { text: "# Genel Bakış\n\nİçerik", inputTokens: 1, outputTokens: 1 };
  }),
  isPromptTooLong: () => false,
  isUsageLimitError: (e: unknown) =>
    /weekly limit|usage limit|kullanım limiti|quota|billing/i.test((e as Error)?.message ?? ""),
}));

import { generateUserManualComplete } from "../src/generator/userManualGenerator";
import type { ScreenContext } from "../src/types/documentation";

function multiTabCtx(): ScreenContext {
  const tab = (i: number, label: string) =>
    ({ label: `Sekme: "${label}"`, triggeredBy: "tab", screenshotPath: `/s/x_tab_${i}.png`, screenshotBase64: `T${i}` });
  return {
    screen: {
      path: "/risk", url: "http://x/risk", title: "Risk",
      screenshotPath: "/s/m.png", screenshotBase64: "M",
      states: [tab(0, "Market"), tab(1, "Player"), tab(2, "Accumulator")],
    },
    analysis: { screenTitle: "Risk", purpose: "p", targetAudience: "a", uiElements: [], workflows: [] },
    preparedChunks: [], paragraphMatches: [], relatedEndpoints: [], relatedSections: [],
  } as unknown as ScreenContext;
}

describe("kullanım limiti → yarım doküman üretilmez", () => {
  it("sekmede limit hatası olursa generateUserManualComplete FIRLATIR (partial yok)", async () => {
    await expect(generateUserManualComplete(multiTabCtx(), [])).rejects.toThrow(/weekly limit/i);
  });
});
