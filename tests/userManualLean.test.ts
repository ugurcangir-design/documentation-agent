import { describe, it, expect, vi, beforeEach } from "vitest";

// callClaude'u mock'la — gönderilen prompt + görselleri yakala.
const calls: Array<{ prompt: string; cachedPrefix?: string; imageBase64?: string; images?: unknown[] }> = [];
vi.mock("../src/llm/claudeClient", () => ({
  callClaude: vi.fn(async (opts: { prompt: string; cachedPrefix?: string; imageBase64?: string; images?: unknown[] }) => {
    calls.push(opts);
    // Sekme adını prompt'tan türet → ordering testi içerikten doğrulayabilsin.
    const m = /\*\*Aktif Sekme:\*\* (.+)/.exec(opts.prompt);
    const text = m ? `## ${m[1]} Sekmesi\n\nİçerik` : `# Genel Bakış\n\nİçerik`;
    return { text, inputTokens: 10, outputTokens: 5 };
  }),
  isPromptTooLong: () => false,
}));

import { generateUserManualSection, generateUserManualComplete } from "../src/generator/userManualGenerator";
import type { ScreenContext } from "../src/types/documentation";

function makeCtx(): ScreenContext {
  return {
    screen: {
      path: "/risk/cats",
      url: "http://x/risk/cats",
      title: "Risk",
      screenshotPath: "/s/main.png",
      screenshotBase64: "MAINIMG",
      states: [
        { label: 'Sekme: "Market"', triggeredBy: "tab", screenshotPath: "/s/x_tab_0.png", screenshotBase64: "TAB0" },
        { label: "Modal: Ekle", triggeredBy: "buton", screenshotPath: "/s/x_tab_0_btn_1.png", screenshotBase64: "B1" },
      ],
    },
    analysis: {
      screenTitle: "Risk Categories",
      purpose: "Risk yönetimi",
      targetAudience: "Analist",
      uiElements: [{ label: "Ekle", type: "button", description: "Yeni kayıt", isGlobalNav: false }],
      workflows: [{ name: "Kayıt Ekleme", trigger: "Ekle", steps: ["Tıkla", "Doldur", "Kaydet"] }],
    },
    preparedChunks: [{ title: "İş Kuralı X", sourceType: "brd", content: "AĞIR_BRD_BAĞLAMI ".repeat(800) }],
    paragraphMatches: [],
    relatedEndpoints: [{ endpoint: { method: "GET", path: "/api/cats", summary: "liste" } }],
    relatedSections: [],
  } as unknown as ScreenContext;
}

describe("userManual yalın sekme modu (token tasarrufu)", () => {
  beforeEach(() => { calls.length = 0; });

  it("GENEL BAKIŞ: ağır bağlam (BRD/API) ve ana görsel GÖNDERİLİR", async () => {
    await generateUserManualSection(makeCtx(), ["STİL ŞABLONU ".repeat(100)]);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.prompt).toContain("BRD / CONFLUENCE BAĞLAMI");
    expect(c.prompt).toContain("API ENDPOINT");
    expect(c.imageBase64).toBe("MAINIMG");
    expect((c.cachedPrefix || "")).toContain("ÖRNEK ŞABLON");
  });

  it("SEKME: ağır bağlam, API, şablon ve ana görsel ÇIKARILIR (yalın)", async () => {
    await generateUserManualSection(makeCtx(), ["STİL ŞABLONU ".repeat(100)], {
      statesOverride: [
        { label: 'Sekme: "Market"', triggeredBy: "tab", screenshotPath: "/s/x_tab_0.png", screenshotBase64: "TAB0" },
      ],
      tabLabel: "Market",
    });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.prompt).not.toContain("BRD / CONFLUENCE BAĞLAMI");
    expect(c.prompt).not.toContain("API ENDPOINT");
    expect(c.imageBase64).toBeUndefined();           // ana görsel gönderilmedi
    expect((c.cachedPrefix || "")).not.toContain("ÖRNEK ŞABLON"); // şablon çıkarıldı
    expect(c.prompt).toContain("Market Sekmesi");     // odak korunuyor
    expect(c.prompt).toContain("UI ÖĞELERİ");          // UI öğeleri korunuyor (kalite)
  });

  it("yalın sekme prompt'u genel bakıştan belirgin ölçüde KISA olmalı", async () => {
    await generateUserManualSection(makeCtx(), ["STİL ŞABLONU ".repeat(100)]);
    const overviewLen = (calls[0]!.cachedPrefix || "").length + calls[0]!.prompt.length;
    calls.length = 0;
    await generateUserManualSection(makeCtx(), ["STİL ŞABLONU ".repeat(100)], { tabLabel: "Market", statesOverride: makeCtx().screen.states ?? [] });
    const tabLen = (calls[0]!.cachedPrefix || "").length + calls[0]!.prompt.length;
    expect(tabLen).toBeLessThan(overviewLen * 0.7); // en az %30 küçülme
  });
});

describe("paralel sekme üretimi — sıra korunur (kalite/token etkisiz)", () => {
  beforeEach(() => { calls.length = 0; });

  function multiTabCtx(): ScreenContext {
    const tabState = (i: number, label: string) =>
      ({ label: `Sekme: "${label}"`, triggeredBy: "tab", screenshotPath: `/s/x_tab_${i}.png`, screenshotBase64: `T${i}` });
    return {
      screen: {
        path: "/risk", url: "http://x/risk", title: "Risk",
        screenshotPath: "/s/main.png", screenshotBase64: "MAIN",
        states: [tabState(0, "Market"), tabState(1, "Player"), tabState(2, "Accumulator")],
      },
      analysis: {
        screenTitle: "Risk", purpose: "p", targetAudience: "a",
        uiElements: [{ label: "Ekle", type: "button", description: "d", isGlobalNav: false }],
        workflows: [],
      },
      preparedChunks: [], paragraphMatches: [], relatedEndpoints: [], relatedSections: [],
    } as unknown as ScreenContext;
  }

  it("3 sekme paralel üretilse de birleştirme sırası genel bakış → Market → Player → Accumulator", async () => {
    process.env.TAB_GEN_CONCURRENCY = "3";
    const res = await generateUserManualComplete(multiTabCtx(), []);
    const b = res.content;
    const iOv = b.indexOf("Genel Bakış");
    const iM = b.indexOf("Market Sekmesi");
    const iP = b.indexOf("Player Sekmesi");
    const iA = b.indexOf("Accumulator Sekmesi");
    expect(iOv).toBeGreaterThanOrEqual(0);
    expect(iM).toBeGreaterThan(iOv);
    expect(iP).toBeGreaterThan(iM);
    expect(iA).toBeGreaterThan(iP);
    // 4 çağrı: genel bakış + 3 sekme (paralel ama hepsi yapılır).
    expect(calls).toHaveLength(4);
  });
});
