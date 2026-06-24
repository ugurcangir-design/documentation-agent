import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude, isPromptTooLong } from "../llm/claudeClient";
import { selectRepresentativeStates } from "./selectStates";
import { isSidebarNav } from "../quality/sidebarNav";
import type { GenerationResult } from "./userManualGenerator";

function buildPrompt(ctx: ScreenContext, templates: string[]): { cachedPrefix: string; prompt: string } {
  const cfg = loadPromptConfig("technicalDoc");

  const brdContext = ctx.preparedChunks
    .map((c) => `### ${c.title} (${c.sourceType})\n${c.content}`)
    .join("\n\n");

  const paragraphContext = ctx.paragraphMatches.length > 0
    ? "\n\n### BRD İlave Paragraflar (long-tail)\n" +
      ctx.paragraphMatches.map((m) => `> _[${m.sectionTitle}]_ ${m.paragraph}`).join("\n\n")
    : "";

  const apiContext = ctx.relatedEndpoints
    .map((r) => `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""} (service: ${r.endpoint.serviceName})`)
    .join("\n");

  // Sidebar/global nav filter — tek kaynak: quality/sidebarNav.
  const inScopeElements = ctx.analysis.uiElements.filter((el) => !isSidebarNav(el));

  // Single consolidated UI elements block (replaces duplicate detail
  // list + coverage list — same info served once).
  const uiElementsBlock = inScopeElements
    .map((el, i) =>
      `${i + 1}. **${el.label}** (${el.type}) — ${el.description}${el.action ? ` → ${el.action}` : ""}`
    )
    .join("\n");

  const templateBlock = templates.length > 0
    ? `\n\n### Örnek Şablon (yapı referansı)\n\nDikkat: Aşağıdaki şablon kullanıcı kılavuzu olabilir — TEKNİK dökümanını şablonun tarzında değil, kendi başına teknik referans olarak yaz. Şablonu sadece terminoloji çıkarımı için kullanabilirsin.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} (sadece sözlük olarak kullan) ---\n${t.slice(0, 4000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n`
    : "";

  const representativeStates = selectRepresentativeStates(ctx.screen.states ?? []);
  const stateCount = representativeStates.length;
  const stateBlock = stateCount > 0
    ? `\n\n# ${stateCount + 1} GÖRSEL VERİLDİ\n\n` +
      `Görsel 1: Ana ekran\n` +
      representativeStates.map((s, i) => `Görsel ${i + 2}: ${s.label} _(${s.triggeredBy})_`).join("\n") +
      `\n\nKullanım:\n` +
      `- 'Veri Tablosu' → kolon spec'leri görsellerden\n` +
      `- 'Filtreleme Mekanizması' → filtre paneli görselinden alan davranışı\n` +
      `- 'Form ve Modal Spec'leri' → her modal görselinden alan listesi\n` +
      `- 'API Bağlantıları' → Swagger eşlemesi\n\n` +
      `Kullanıcı kılavuzundaki akışları TEKRAR YAZMA — sadece teknik spec.\n`
    : "";

  // Job-stable prefix (aynı job içinde tüm ekranlarda byte-byte aynı → cache hit).
  const cachedPrefix = [
    buildPromptHeader(cfg),
    templateBlock,
    buildPromptFooter(cfg),
  ].filter((s) => s && s.trim().length > 0).join("\n\n");

  const prompt = `**Ekran:** ${ctx.analysis.screenTitle} · ${ctx.screen.path}
**Amaç:** ${ctx.analysis.purpose}
**Veriler:** ${ctx.analysis.dataDisplayed.join(", ")}

# UI BİLEŞENLERİ — HER BİRİ İÇİN BİLEŞEN ENVANTERİ TABLOSUNDA BİR SATIR (${inScopeElements.length} adet, sidebar/global nav hariç)

${uiElementsBlock}

# BRD / CONFLUENCE BAĞLAMI

${brdContext || "_(yok)_"}${paragraphContext}

# API ENDPOINT'LERİ

${apiContext || "_(yok)_"}
${stateBlock}
---

**Yasak:** Görsellerde sol sidebar'da 'Sport Base Data', 'Sports' vb. global nav öğeleri görebilirsin — bu ekranın parçası DEĞİL. Bahsetme. Yalnızca URL'i ${ctx.screen.path} olan ekrana özgü bileşenleri spec'leme.

Bu ekran için TEKNİK DÖKÜMAN yaz. Geliştirici sayfayı sıfırdan inşa edebilsin, QA test case çıkarabilsin.`;

  return { cachedPrefix, prompt };
}

export async function generateTechnicalDocSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("technicalDoc");
  const allStates = selectRepresentativeStates(ctx.screen.states ?? []);

  async function runWithBudget(stateCap: number, tmplChars: number): Promise<GenerationResult> {
    const useStates = allStates.slice(0, stateCap);
    const useTemplates = templates.map((t) => t.slice(0, tmplChars));
    const trimmedCtx: ScreenContext = {
      ...ctx,
      screen: { ...ctx.screen, states: useStates },
    };
    const stateImages = useStates.map((s) => ({
      base64: s.screenshotBase64,
      path: s.screenshotPath,
      label: s.label,
    }));
    const { cachedPrefix, prompt } = buildPrompt(trimmedCtx, useTemplates);
    const result = await callClaude({
      prompt,
      cachedPrefix,
      imageBase64: ctx.screen.screenshotBase64,
      imagePath: ctx.screen.screenshotPath,
      images: stateImages,
      maxTokens: cfg.maxTokens ?? 8000,
    });
    const out: GenerationResult = {
      content: cleanGeneratedMarkdown(result.text),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens ?? 0,
      cacheCreationTokens: result.cacheCreationTokens ?? 0,
    };
    if (result.truncated) out.truncated = true;
    return out;
  }

  try {
    return await runWithBudget(allStates.length, 4000);
  } catch (err) {
    if (!isPromptTooLong(err)) throw err;
    console.warn("[technicalDoc] prompt too long — retrying with reduced context");
    try {
      return await runWithBudget(Math.max(5, Math.floor(allStates.length / 2)), 2000);
    } catch (err2) {
      if (!isPromptTooLong(err2)) throw err2;
      console.warn("[technicalDoc] still too long — minimal context");
      return await runWithBudget(4, 1000);
    }
  }
}
