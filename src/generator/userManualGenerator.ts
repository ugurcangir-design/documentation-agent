import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude } from "../llm/claudeClient";
import { selectRepresentativeStates } from "./selectStates";

export interface GenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

function buildPrompt(ctx: ScreenContext, templates: string[]): string {
  const cfg = loadPromptConfig("userManual");

  const brdContext = ctx.preparedChunks
    .map((c) => `### ${c.title} (${c.sourceType})\n${c.content}`)
    .join("\n\n");

  const paragraphContext = ctx.paragraphMatches.length > 0
    ? "\n\n### BRD'den İlave Paragraflar (uzun-kuyruk eşleşmeler)\n\n" +
      ctx.paragraphMatches
        .map((m) => `> _[${m.sectionTitle}]_ ${m.paragraph}`)
        .join("\n\n")
    : "";

  const apiContext = ctx.relatedEndpoints
    .map((r) => `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""}`)
    .join("\n");

  const uiElements = ctx.analysis.uiElements
    .map((el) => `- ${el.type.toUpperCase()}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");

  // Explicit per-element coverage requirement — forces narrative coverage
  // of EVERY UI element the analyzer detected, not just a representative few.
  const coverageList = ctx.analysis.uiElements
    .map((el, i) => `${i + 1}. "${el.label}" (${el.type})`)
    .join("\n");
  const workflowList = ctx.analysis.workflows
    .map((wf, i) => `${i + 1}. ${wf.name}`)
    .join("\n");

  const workflows = ctx.analysis.workflows
    .map((wf) => `**${wf.name}**${wf.trigger ? ` (Tetikleyici: ${wf.trigger})` : ""}:\n${wf.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`)
    .join("\n\n");

  const templateBlock = templates.length > 0
    ? `\n\n### ÖRNEK ŞABLON KILAVUZ — BU FORMAT VE ÜSLUBA UY\n\nAşağıdaki örnek dökümanı dikkatle incele. Senin yazacağın kılavuz **bu dökümanın anlatım üslubu, paragraf-cümle yapısı, başlık tarzı ve detay seviyesinde** olmalı. İçeriği KOPYALAMA — sadece formu örnek al.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} ---\n${t.slice(0, 8000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n\nÖZELLIKLE DİKKAT ET:\n- Şablon adımları nasıl numaralandırıyor → aynı şekilde yap\n- Şablon ne kadar açıklayıcı (her butonu ayrı paragraf mı, kısa madde mi)\n- Şablonun \"sen/siz\" hitabı nasıl → onu kullan\n- Şablonda kullanılan terimleri (örn: 'panel', 'sekme', 'kayıt') benimse\n`
    : "";

  // Build URL-based image catalog. Express serves files from
  // data/screenshots/ at /screenshots/<basename>.
  const basename = (p: string) => p.split("/").pop() ?? p;
  const mainImgUrl = `/screenshots/${basename(ctx.screen.screenshotPath)}`;

  const representativeStates = selectRepresentativeStates(ctx.screen.states ?? []);
  const stateImageList = representativeStates.map((s, i) => ({
    n: i + 2,
    label: s.label,
    triggeredBy: s.triggeredBy,
    url: `/screenshots/${basename(s.screenshotPath)}`,
  }));

  const imageCatalog =
    `### KULLANILABİLİR EKRAN GÖRÜNTÜLERİ\n\n` +
    `Aşağıdaki görsellerin markdown image syntax'i hazırdır. ` +
    `Kılavuzda ilgili anlatımın yanına bunları **doğrudan satır içine** EKLEMELİSİN:\n\n` +
    `1. Ana ekran:\n   \`![Prematch Program ana ekran](${mainImgUrl})\`\n\n` +
    stateImageList
      .map(
        (s) =>
          `${s.n}. ${s.label} _(${s.triggeredBy})_:\n   \`![${s.label}](${s.url})\``
      )
      .join("\n\n");

  const stateCount = stateImageList.length;
  const stateBlock = stateCount > 0
    ? `\n\nSANA TOPLAM ${stateCount + 1} GÖRSEL VERİLDİ:\n  Görsel #1: Ana ekran\n${stateImageList.map(s => `  Görsel #${s.n}: ${s.label} — (${s.triggeredBy})`).join("\n")}\n\n${imageCatalog}\n\nGÖRSEL EKLEME KURALI (ZORUNLU):\n- 'Ekrana İlk Bakış' bölümünün ilk paragrafından sonra **ana ekran görselini** ekle.\n- 'Adım Adım Kullanım' içindeki her akışta, ilgili modal/dropdown/panel ile etkileşim anlatılıyorsa **o state'in görselini** o adımın yanına ekle.\n- 'Modallar ve Yan Paneller' altındaki her alt başlıkta o modal'ın görselini başlığın hemen altında göster.\n- 'Filtreler ve Arama Seçenekleri' bölümünde filtre paneli açık görseli kullan.\n- 'Satır Üzerindeki İşlemler' bölümünde satır aksiyon menüsü görselleri kullan.\n- En az 6 farklı görsel kılavuzun farklı yerlerine yerleştirilmiş olmalı.\n- Görselleri AYNEN yukarıdaki listedeki path'lerle kullan (örn: \`![Filters paneli](/screenshots/event-management_prematch-program_btn_1.png)\`).\n\nUNUTMA: KILAVUZUN, kullanıcının ekran karşısında olmadan bile ne göreceğini görsellerle anlamasına izin vermeli.\n`
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
${brdContext || "(Yok)"}${paragraphContext}

İlgili API Endpoint'leri:
${apiContext || "(Yok)"}
${stateBlock}${templateBlock}
---

# KAPSAM ZORUNLULUĞU — KILAVUZUN HER ÖĞEYİ İŞLEMESİ ŞARTTIR

Aşağıdaki ${ctx.analysis.uiElements.length} UI öğesi ekranda tespit edildi. Kılavuzun bir yerinde **her birinden bahsetmek zorundasın** (envanter tablosu olarak değil, akışlar/bölümler içinde doğal anlatımla):

${coverageList}

Aşağıdaki ${ctx.analysis.workflows.length} iş akışı için ayrıca **Adım Adım Kullanım** altında ayrı alt başlık aç:

${workflowList || "(akış tespit edilmedi — sen 3-5 ana akışı görsellerden çıkar)"}

---

Bu ekran için KULLANICI KILAVUZU yaz. Kullanıcı sadece bu dökümana bakarak ekrandaki her butona, alana, filtreye, satır işlemine hakim olabilmeli. Hiçbir görünür element atlanmamalı.

${buildPromptFooter(cfg)}`;
}

export async function generateUserManualSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("userManual");

  const stateImages = selectRepresentativeStates(ctx.screen.states ?? []).map((s) => ({
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
