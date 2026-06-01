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
- Şüpheliyse false (asıl öğe gibi davran — fazladan açıklama zararsız).

EKSİKSİZ OL — EN ÖNEMLİ KURAL:
Bu analiz, ekranın kullanım kılavuzunun temelidir. Ana içerik alanındaki
HER etkileşimli öğeyi eksiksiz listele — kaç tane olursa olsun KISALTMA,
özetleme, "vb." deyip geçme. Şunların TAMAMINI ayrı uiElements girdisi yap:
- Her buton (birincil, ikincil, ikon buton, satır içi aksiyon)
- Her form alanı / input / dropdown / checkbox / radio / toggle / tarih seçici
- Her filtre ve arama kutusu
- Tablo/liste kolonları (sıralanabilir/filtrelenebilir olanlar)
- Her sekme, modal-açan tetikleyici, sayfalama kontrolü
- Verilen ek görsellerde (modal/panel/dropdown açık halleri) görünen
  TÜM iç alanları da ekle — bunlar ana ekranda kapalıdır ama ekranın
  parçasıdır.
Bir öğeyi atlamak, kılavuzda eksik anlatıma yol açar. Tereddütte ekle.`;

// Analiz prompt'u / maxTokens / şeması her değiştiğinde artır. Cache
// anahtarına karıştığı için eski (farklı prompt sürümüyle üretilmiş)
// analizler otomatik geçersiz kalır — aksi halde aynı screenshot eski
// eksik analizi sonsuza dek döndürürdü (cache hash yalnız görsele bağlı).
const ANALYZER_VERSION = "v2-exhaustive-8k";

export async function analyzeScreen(screen: DiscoveredScreen): Promise<ScreenAnalysis> {
  const hash = hashScreenshot(screen.screenshotBase64 + ANALYZER_VERSION);
  const cached = analysisCache.get(hash);
  if (cached) return cached;

  const cfg = loadPromptConfig("screenAnalysis");
  const prompt = `${cfg.instructions ?? "Bu bir web uygulamasının ekran görüntüsüdür."}

${JSON_SCHEMA_HINT}`;

  const result = await callClaude({
    prompt,
    imageBase64: screen.screenshotBase64,
    imagePath: screen.screenshotPath,
    // Zengin ekranlarda (30+ UI öğesi) 2048 token yetmiyordu; analiz JSON'u
    // kesilince ya parse hatası ya da Claude'un sessizce öğe kısması olur →
    // kılavuzda eksik alan/buton. 8000 token ~100+ öğeye yer açar.
    maxTokens: cfg.maxTokens ?? 8000,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Screen analysis returned no JSON for: ${screen.path}\nResponse: ${result.text.slice(0, 200)}`);
  }

  // Çıktı max_tokens'a takıldıysa JSON büyük olasılıkla eksik → analiz
  // kapsamı güvenilir değil. Sessiz kabul yerine net hata: ekran fail
  // olur (Geçmiş → Eksikleri Üret ile tekrar denenebilir) ve kullanıcı
  // maxTokens'ı artırması gerektiğini bilir.
  if (result.truncated) {
    throw new Error(
      `Ekran analizi max_tokens limitine takıldı (${screen.path}) — çıktı kesildi, ` +
      `UI öğeleri eksik kalmış olabilir. screenAnalysis maxTokens değerini artırın ` +
      `(Sistem Promptları) veya ekranı bölün.`
    );
  }

  let analysis: ScreenAnalysis;
  try {
    analysis = JSON.parse(jsonMatch[0]) as ScreenAnalysis;
  } catch (e) {
    throw new Error(
      `Ekran analizi JSON ayrıştırılamadı (${screen.path}): ${(e as Error).message}. ` +
      `Yanıt başı: ${jsonMatch[0].slice(0, 150)}`
    );
  }

  // Hiç UI öğesi çıkmadıysa görsel boş/anlamsız (auth-wall, hata sayfası,
  // boş state) olabilir → kılavuz halüsinasyona açık. Uyar ama bloklamadan
  // devam et (bazı ekranlar gerçekten salt-okunur olabilir).
  if (!analysis.uiElements || analysis.uiElements.length === 0) {
    console.warn(`[analyze] ${screen.path}: UI öğesi tespit edilmedi — boş/erişilemez ekran olabilir`);
  }

  analysisCache.set(hash, analysis);
  return analysis;
}
