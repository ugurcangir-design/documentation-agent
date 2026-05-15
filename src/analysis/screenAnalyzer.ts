import Anthropic from "@anthropic-ai/sdk";

import { env } from "../config/env";
import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";

const client = new Anthropic({
  apiKey: env.anthropicApiKey,
});

const ANALYSIS_PROMPT = `Bu bir web uygulamasının ekran görüntüsüdür.

Aşağıdakileri analiz et ve SADECE geçerli JSON formatında döndür:

{
  "screenTitle": "Ekranın başlığı veya adı",
  "purpose": "Bu ekranın amacı ve ne işe yaradığı (2-3 cümle, Türkçe)",
  "targetAudience": "Bu ekranı kullanan kullanıcı tipi (örn: analist, yönetici, trader)",
  "uiElements": [
    {
      "type": "button|form|table|chart|modal|dropdown|input|tab|menu|filter|other",
      "label": "Elementin görünen etiketi veya adı",
      "description": "Bu elementin ne işe yaradığı",
      "action": "Tıklandığında veya kullanıldığında ne olur (opsiyonel)"
    }
  ],
  "workflows": [
    {
      "name": "İş akışının adı",
      "trigger": "Bu akışı başlatan eylem (opsiyonel)",
      "steps": ["Adım 1", "Adım 2", "..."]
    }
  ],
  "dataDisplayed": ["Ekranda gösterilen veri türleri (örn: fiyat, tarih, kullanıcı adı)"],
  "navigationOptions": ["Bu ekrandan erişilebilen diğer ekranlar veya özellikler"]
}

Başka hiçbir şey yazma, sadece JSON döndür.`;

export async function analyzeScreen(
  screen: DiscoveredScreen
): Promise<ScreenAnalysis> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screen.screenshotBase64,
            },
          },
          {
            type: "text",
            text: ANALYSIS_PROMPT,
          },
        ],
      },
    ],
  });

  const firstBlock = response.content[0];
  const text =
    firstBlock?.type === "text" ? firstBlock.text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error(
      `Screen analysis returned no JSON for: ${screen.path}\nResponse: ${text.slice(0, 200)}`
    );
  }

  return JSON.parse(jsonMatch[0]) as ScreenAnalysis;
}
