import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { loadPromptConfig } from "../config/promptConfig";
import { analysisCache, hashScreenshot } from "../server/store/analysisCache";
import { callClaude } from "../llm/claudeClient";

const JSON_SCHEMA_HINT = `JSON şeması:
{
  "screenTitle": "Ekranın başlığı veya adı",
  "purpose": "Bu ekranın amacı ve ne işe yaradığı (2-3 cümle, Türkçe)",
  "targetAudience": "Bu ekranı kullanan kullanıcı tipi",
  "uiElements": [
    {
      "type": "button|form|table|chart|modal|dropdown|input|tab|menu|filter|other",
      "label": "Elementin görünen etiketi",
      "description": "Bu elementin ne işe yaradığı",
      "action": "Tıklandığında veya kullanıldığında ne olur (opsiyonel)",
      "isGlobalNav": false
    }
  ],
  "workflows": [
    { "name": "İş akışının adı", "trigger": "Tetikleyici (opsiyonel)", "steps": ["Adım 1", "..."] }
  ],
  "dataDisplayed": ["Ekranda gösterilen veri türleri"],
  "navigationOptions": ["Bu ekrandan erişilebilen diğer ekranlar"]
}

ÖNEMLİ — isGlobalNav alanı:
- Bu ekranın *parçası olmayan*, başka ekrana yönlendiren global navigasyon
  öğeleri (sol sidebar menü öğeleri, üst bar menüleri, "Logout" gibi) için
  isGlobalNav: true.
- Bu ekranın asıl içeriğine ait butonlar, filtreler, satır işlemleri,
  formlar, modal'lar için isGlobalNav: false.
- Test: "Bu öğeyi anlatmazsam analist bu ekranı eksik tanır mı?" Yanıt EVET
  ise isGlobalNav=false (asıl öğe). HAYIR ise isGlobalNav=true (nav).
- Şüpheliyse false (asıl öğe gibi davran — fazladan açıklama zararsız).`;

export async function analyzeScreen(screen: DiscoveredScreen): Promise<ScreenAnalysis> {
  const hash = hashScreenshot(screen.screenshotBase64);
  const cached = analysisCache.get(hash);
  if (cached) return cached;

  const cfg = loadPromptConfig("screenAnalysis");
  const prompt = `${cfg.instructions ?? "Bu bir web uygulamasının ekran görüntüsüdür."}

${JSON_SCHEMA_HINT}`;

  const result = await callClaude({
    prompt,
    imageBase64: screen.screenshotBase64,
    imagePath: screen.screenshotPath,
    maxTokens: cfg.maxTokens ?? 2048,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Screen analysis returned no JSON for: ${screen.path}\nResponse: ${result.text.slice(0, 200)}`);
  }

  const analysis = JSON.parse(jsonMatch[0]) as ScreenAnalysis;
  analysisCache.set(hash, analysis);
  return analysis;
}
