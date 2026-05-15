import Anthropic from "@anthropic-ai/sdk";

import { env } from "../config/env";
import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";

const client = new Anthropic({
  apiKey: env.anthropicApiKey,
});

function buildPrompt(ctx: ScreenContext): string {
  const brdContext = ctx.relatedSections
    .map(
      (r) =>
        `### ${r.section.title} (${r.section.sourceType})\n${r.section.content}`
    )
    .join("\n\n");

  const apiContext = ctx.relatedEndpoints
    .map(
      (r) =>
        `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""}`
    )
    .join("\n");

  const uiElements = ctx.analysis.uiElements
    .map(
      (el) =>
        `- ${el.type.toUpperCase()}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`
    )
    .join("\n");

  const workflows = ctx.analysis.workflows
    .map(
      (wf) =>
        `**${wf.name}**${wf.trigger ? ` (Tetikleyici: ${wf.trigger})` : ""}:\n${wf.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`
    )
    .join("\n\n");

  return `Sen deneyimli bir teknik yazar ve ürün uzmanısın.

Aşağıdaki bilgiler verilmiştir:
- Ekran başlığı: ${ctx.analysis.screenTitle}
- URL: ${ctx.screen.path}
- Ekran amacı: ${ctx.analysis.purpose}
- Hedef kullanıcı: ${ctx.analysis.targetAudience || "Genel kullanıcı"}

UI Elementleri:
${uiElements}

İş Akışları:
${workflows}

İlgili BRD Bölümleri:
${brdContext || "(Yok)"}

İlgili API Endpoint'leri:
${apiContext || "(Yok)"}

---

Bu ekran için KULLANICI KILAVUZU bölümü yaz. Teknik olmayan bir son kullanıcının anlayabileceği dilde olmalı.

Şu yapıyı kullan:

## [Ekran Adı]

### Genel Bakış
(Bu ekranın ne işe yaradığını 2-3 cümle ile açıkla)

### Ekrandaki Özellikler
(Her UI elementini tabloda veya madde madde açıkla: ne işe yarar, nasıl kullanılır)

### Adım Adım Kullanım
(En yaygın iş akışı için numaralı adımlar)

### Önemli Notlar
(Dikkat edilmesi gereken özel durumlar, varsa)

Kurallar:
- Türkçe yaz
- Teknik jargon kullanma, sade ol
- Sadece bu ekrana ait bilgileri yaz
- Başka section ekleme`;
}

export async function generateUserManualSection(
  ctx: ScreenContext
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: ctx.screen.screenshotBase64,
            },
          },
          {
            type: "text",
            text: buildPrompt(ctx),
          },
        ],
      },
    ],
  });

  const firstBlock = response.content[0];
  const text =
    firstBlock?.type === "text" ? firstBlock.text : "";

  return cleanGeneratedMarkdown(text);
}
