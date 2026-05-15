import Anthropic from "@anthropic-ai/sdk";

import { env } from "../config/env";
import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import type { GenerationResult } from "./userManualGenerator";

const client = new Anthropic({ apiKey: env.anthropicApiKey });

function buildPrompt(ctx: ScreenContext, templates: string[]): string {
  const cfg = loadPromptConfig("technicalDoc");

  const brdContext = ctx.relatedSections
    .map((r) => `### ${r.section.title} (${r.section.sourceType})\n${r.section.content}`)
    .join("\n\n");

  const apiContext = ctx.relatedEndpoints
    .map((r) => `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""} (service: ${r.endpoint.serviceName})`)
    .join("\n");

  const uiElements = ctx.analysis.uiElements
    .map((el) => `- ${el.type}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");

  const templateBlock = templates.length > 0
    ? `\n\n### Şablon Referansı (Anlatım dilini, başlık yapısını ve detay seviyesini taklit et — içeriği kopyalama)\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} ---\n${t.slice(0, 4000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n`
    : "";

  return `${buildPromptHeader(cfg)}

Aşağıdaki veriler verilmiştir:
- Ekran: ${ctx.analysis.screenTitle}
- URL: ${ctx.screen.path}
- Amaç: ${ctx.analysis.purpose}
- Ekranda gösterilen veriler: ${ctx.analysis.dataDisplayed.join(", ")}

UI Elementleri:
${uiElements}

İlgili BRD / Confluence Bölümleri:
${brdContext || "(Yok)"}

İlgili API Endpoint'leri:
${apiContext || "(Yok)"}
${templateBlock}
---

Bu ekran için TEKNİK DÖKÜMAN bölümü yaz. Geliştirici ve sistem analisti hedef kitlesi.

${buildPromptFooter(cfg)}`;
}

export async function generateTechnicalDocSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("technicalDoc");
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: cfg.maxTokens ?? 3000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: ctx.screen.screenshotBase64 } },
        { type: "text", text: buildPrompt(ctx, templates) },
      ],
    }],
  });

  const firstBlock = response.content[0];
  const text = firstBlock?.type === "text" ? firstBlock.text : "";

  return {
    content: cleanGeneratedMarkdown(text),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
