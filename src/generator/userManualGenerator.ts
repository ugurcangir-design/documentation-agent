import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude } from "../llm/claudeClient";

export interface GenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

function buildPrompt(ctx: ScreenContext, templates: string[]): string {
  const cfg = loadPromptConfig("userManual");

  const brdContext = ctx.relatedSections
    .map((r) => `### ${r.section.title} (${r.section.sourceType})\n${r.section.content}`)
    .join("\n\n");

  const apiContext = ctx.relatedEndpoints
    .map((r) => `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""}`)
    .join("\n");

  const uiElements = ctx.analysis.uiElements
    .map((el) => `- ${el.type.toUpperCase()}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");

  const workflows = ctx.analysis.workflows
    .map((wf) => `**${wf.name}**${wf.trigger ? ` (Tetikleyici: ${wf.trigger})` : ""}:\n${wf.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`)
    .join("\n\n");

  const templateBlock = templates.length > 0
    ? `\n\n### Şablon Referansı (Anlatım dilini, başlık yapısını ve detay seviyesini taklit et — içeriği kopyalama)\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} ---\n${t.slice(0, 4000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n`
    : "";

  const stateBlock = (ctx.screen.states ?? []).length > 0
    ? `\n\nAyrıca, test user simülasyonu sırasında yakalanan ek state'ler de görsellerde mevcuttur:\n${(ctx.screen.states ?? []).map((s, i) => `${i + 2}. ${s.label} — ${s.triggeredBy}`).join("\n")}\n\nBu state'leri kullanarak hangi etkileşimin (tıklama, sekme değiştirme, modal açma) ne sonuç doğurduğunu açıkla.\n`
    : "";

  return `${buildPromptHeader(cfg)}

Aşağıdaki bilgiler verilmiştir:
- Ekran başlığı: ${ctx.analysis.screenTitle}
- URL: ${ctx.screen.path}
- Ekran amacı: ${ctx.analysis.purpose}
- Hedef kullanıcı: ${ctx.analysis.targetAudience || "Genel kullanıcı"}

UI Elementleri:
${uiElements}

İş Akışları:
${workflows}

İlgili BRD / Confluence Bölümleri:
${brdContext || "(Yok)"}

İlgili API Endpoint'leri:
${apiContext || "(Yok)"}
${stateBlock}${templateBlock}
---

Bu ekran için KULLANICI KILAVUZU bölümü yaz. Teknik olmayan bir son kullanıcının anlayabileceği dilde olmalı.

${buildPromptFooter(cfg)}`;
}

export async function generateUserManualSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("userManual");

  const stateImages = (ctx.screen.states ?? []).map((s) => ({
    base64: s.screenshotBase64,
    path: s.screenshotPath,
    label: s.label,
  }));

  const result = await callClaude({
    prompt: buildPrompt(ctx, templates),
    imageBase64: ctx.screen.screenshotBase64,
    imagePath: ctx.screen.screenshotPath,
    images: stateImages,
    maxTokens: cfg.maxTokens ?? 3000,
  });

  return {
    content: cleanGeneratedMarkdown(result.text),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
