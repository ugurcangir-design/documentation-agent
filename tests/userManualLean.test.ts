import { describe, it, expect, vi, beforeEach } from "vitest";

// callClaude'u mock'la — gönderilen prompt + görselleri yakala.
const calls: Array<{ prompt: string; cachedPrefix?: string; imageBase64?: string; images?: unknown[] }> = [];
// Sekme adı → kalan başarısızlık sayısı (retry testleri bunu doldurur).
const failPlan: Record<string, number> = {};
vi.mock("../src/llm/claudeClient", () => ({
  callClaude: vi.fn(async (opts: { prompt: string; cachedPrefix?: string; imageBase64?: string; images?: unknown[] }) => {
    calls.push(opts);
    // Sekme adını prompt'tan türet → ordering testi içerikten doğrulayabilsin.
    const m = /\*\*Aktif Sekme:\*\* (.+)/.exec(opts.prompt);
    const label = m?.[1];
    if (label && (failPlan[label] ?? 0) > 0) {
      failPlan[label]!--;
      throw new Error(`simulated failure for ${label}`);
    }
    const text = m ? `## ${m[1]} Sekmesi\n\nİçerik` : `# Genel Bakış\n\nİçerik`;
    return { text, inputTokens: 10, outputTokens: 5 };
  }),
  isPromptTooLong: () => false,
  isUsageLimitError: () => false,
  MODEL_QUALITY: "claude-sonnet-4-6",
  MODEL_FAST: "claude-haiku-4-5",
}));

import { generateUserManualSection, generateUserManualComplete, SECTION_JOINER } from "../src/generator/userManualGenerator";
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
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(failPlan)) delete failPlan[k]; });

  it("GENEL BAKIŞ: ağır bağlam (BRD/API) ve ana görsel GÖNDERİLİR", async () => {
    await generateUserManualSection(makeCtx(), ["STİL ŞABLONU ".repeat(100)]);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.prompt).toContain("BRD / CONFLUENCE BAĞLAMI");
    expect(c.prompt).toContain("API ENDPOINT");
    expect(c.imageBase64).toBe("MAINIMG");
    expect((c.cachedPrefix || "")).toContain("ÖRNEK ŞABLON");
    expect((c.cachedPrefix || "")).toContain("Şu yapıyı kullan"); // tam çıktı yapısı (standart başlıklar) genel bakışta VAR
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
    expect(c.prompt).not.toContain("BRD / CONFLUENCE BAĞLAMI"); // ağır RAG çıkarıldı
    expect(c.prompt).not.toContain("API ENDPOINT");             // API çıkarıldı
    expect(c.imageBase64).toBeUndefined();           // ana görsel gönderilmedi
    expect((c.cachedPrefix || "")).toContain("ÖRNEK ŞABLON");   // stil şablonu KORUNUR (benzerlik)
    expect((c.cachedPrefix || "")).toContain("(özet)");         // ama ÖZET (kısa) tutulur
    expect((c.cachedPrefix || "")).not.toContain("Şu yapıyı kullan"); // standart çıktı yapısı BASTIRILDI → sekmeler tekrarlamaz
    expect(c.prompt).toContain("TEKRAR YASAK");        // ortak/standart bölüm üretme yasağı var
    expect(c.prompt).toContain("Market Sekmesi");     // odak korunuyor
    expect(c.prompt).toContain("UI ÖĞELERİ");          // UI öğeleri korunuyor (kalite)
  });

  it("SEKME: standart alt-başlık şeması dayatılır (adlandırma varyasyonu yasak)", async () => {
    await generateUserManualSection(makeCtx(), [], {
      statesOverride: [
        { label: 'Sekme: "Market"', triggeredBy: "tab", screenshotPath: "/s/x_tab_0.png", screenshotBase64: "TAB0" },
      ],
      tabLabel: "Market",
    });
    const c = calls[0]!;
    expect(c.prompt).toContain("STANDART ALT BAŞLIKLAR");
    expect(c.prompt).toContain("### Sütunlar");
    expect(c.prompt).toContain("### Sekmeye Özgü Filtreler");
    expect(c.prompt).toContain("### Uyarı ve Hata Mesajları");
    expect(c.prompt).toContain("karşılığı olmayanı tamamen atla"); // koşullu — boş bölüm/uydurma yok
    expect(c.prompt).toContain("varyasyonlar YASAK");  // 'Tablo Görünümü' vb. türetme yasağı
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
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(failPlan)) delete failPlan[k]; });

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

  it("çok-sekmede overviewContent + tabsContent ayrık döner; content = overview + joiner + tabs", async () => {
    const res = await generateUserManualComplete(multiTabCtx(), []);
    expect(res.overviewContent).toBeDefined();
    expect(res.tabsContent).toBeDefined();
    expect(res.overviewContent).toContain("Genel Bakış");
    expect(res.tabsContent).toContain("Market Sekmesi");
    expect(res.tabsContent).toContain("Accumulator Sekmesi");
    // Birleşik içerik tam olarak genel bakış + ayraç + sekmeler olmalı.
    expect(res.content).toBe(res.overviewContent! + SECTION_JOINER + res.tabsContent!);
  });

  it("ortak mekanikler: genel bakış 'BİR KEZ anlat' görevini + sekme adlarını alır; sekmeler ekran-geneli mekanik yasağını alır", async () => {
    await generateUserManualComplete(multiTabCtx(), []);
    const overviewCall = calls.find((c) => !/\*\*Aktif Sekme:\*\*/.test(c.prompt))!;
    const tabCalls = calls.filter((c) => /\*\*Aktif Sekme:\*\*/.test(c.prompt));
    // Genel bakış: ortak mekanikleri (sayfalama, sayfa-başına-kayıt, tablo)
    // BİR KEZ anlatma talimatı + sekme adları listelenir.
    expect(overviewCall.prompt).toContain("ORTAK MEKANİKLER");
    expect(overviewCall.prompt).toContain("sayfa başına kayıt sayısı");
    expect(overviewCall.prompt).toContain("Market, Player, Accumulator");
    // Sekmeler: sayfalama/sayfa-başına-kayıt/tablo-mekaniği YAZMA yasağı +
    // genel bakışa referans talimatı.
    expect(tabCalls).toHaveLength(3);
    for (const c of tabCalls) {
      expect(c.prompt).toContain("EKRAN-GENELİ MEKANİKLER YASAK");
      expect(c.prompt).toContain("sayfa başına kayıt sayısı");
      expect(c.prompt).toContain("Genel Bakış bölümüne bakın");
      expect(c.prompt).not.toContain("ORTAK MEKANİKLER — BURADA BİR KEZ ANLAT");
    }
  });

  it("sekme geçici hatada BİR KEZ retry edilir; 2. denemede başarılıysa failedTabs boş kalır", async () => {
    failPlan["Player"] = 1; // ilk deneme başarısız, 2. deneme başarılı
    const res = await generateUserManualComplete(multiTabCtx(), []);
    expect(res.failedTabs).toBeUndefined();
    expect(res.tabsContent).toContain("Player Sekmesi"); // sonunda üretildi
    // Player için 2 çağrı yapıldı (1 başarısız + 1 başarılı), toplam 5 çağrı.
    const playerCalls = calls.filter((c) => /\*\*Aktif Sekme:\*\* Player/.test(c.prompt));
    expect(playerCalls).toHaveLength(2);
  }, 10000);

  it("sekme 2 denemede de başarısız olursa failedTabs'a girer; DİĞER sekmeler ve genel bakış etkilenmez", async () => {
    failPlan["Player"] = 2; // ilk VE ikinci deneme de başarısız
    const res = await generateUserManualComplete(multiTabCtx(), []);
    expect(res.failedTabs).toEqual(["Player"]);
    expect(res.overviewContent).toContain("Genel Bakış"); // genel bakış etkilenmedi
    expect(res.tabsContent).toContain("Market Sekmesi");   // diğer sekmeler etkilenmedi
    expect(res.tabsContent).toContain("Accumulator Sekmesi");
    expect(res.tabsContent).not.toContain("Player Sekmesi"); // kayıp sekme içerikte yok
  }, 10000);
});

describe("tek/sıfır sekme — ayrık parçalar yok (tam doc üzerinde coverage)", () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(failPlan)) delete failPlan[k]; });

  function singleTabCtx(): ScreenContext {
    return {
      screen: {
        path: "/x", url: "http://x", title: "X",
        screenshotPath: "/s/m.png", screenshotBase64: "M",
        states: [{ label: 'Sekme: "Tek"', triggeredBy: "tab", screenshotPath: "/s/x_tab_0.png", screenshotBase64: "T0" }],
      },
      analysis: { screenTitle: "X", purpose: "p", targetAudience: "a", uiElements: [], workflows: [] },
      preparedChunks: [], paragraphMatches: [], relatedEndpoints: [], relatedSections: [],
    } as unknown as ScreenContext;
  }

  it("1 sekme → tek çağrı, overviewContent/tabsContent undefined", async () => {
    const res = await generateUserManualComplete(singleTabCtx(), []);
    expect(res.overviewContent).toBeUndefined();
    expect(res.tabsContent).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});
