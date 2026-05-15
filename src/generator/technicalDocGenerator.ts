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
        `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""} (service: ${r.endpoint.serviceName})`
    )
    .join("\n");

  const uiElements = ctx.analysis.uiElements
    .map(
      (el) =>
        `- ${el.type}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`
    )
    .join("\n");

  return `Sen kıdemli bir yazılım mühendisi ve teknik dokümantasyon uzmanısın.

Aşağıdaki veriler verilmiştir:
- Ekran: ${ctx.analysis.screenTitle}
- URL: ${ctx.screen.path}
- Amaç: ${ctx.analysis.purpose}
- Ekranda gösterilen veriler: ${ctx.analysis.dataDisplayed.join(", ")}

UI Elementleri:
${uiElements}

İlgili BRD Bölümleri:
${brdContext || "(Yok)"}

İlgili API Endpoint'leri:
${apiContext || "(Yok)"}

---

Bu ekran için TEKNİK DÖKÜMAN bölümü yaz. Geliştirici ve sistem analisti hedef kitlesi.

Şu yapıyı kullan:

## [Ekran Adı] — Teknik Detaylar

### Ekran Özeti
(Teknik amaç, sistem içindeki rolü)

### UI Bileşenleri
(Her component'i teknik açıdan açıkla — veri bağlantısı, state, validasyon)

### API Bağlantıları
(Hangi endpoint'ler kullanılıyor, ne zaman çağrılıyor, dönen veri ne)

### İş Kuralları
(BRD'den çıkan veya ekrandan görülen iş kuralları ve kısıtlamalar)

### Veri Akışı
(Kullanıcı aksiyonu → API çağrısı → UI güncelleme zinciri)

### Hata Durumları
(Olası hatalar ve ekranın nasıl davranması gerektiği)

### Açık Sorular
(Doğrulanması gereken noktalar varsa listele)

Kurallar:
- Türkçe yaz
- Sadece context'te olan bilgileri kullan, uydurma
- Eksik bilgi varsa "Doğrulama Gerekiyor" yaz
- Sadece bu ekrana ait bölümü yaz`;
}

export async function generateTechnicalDocSection(
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
