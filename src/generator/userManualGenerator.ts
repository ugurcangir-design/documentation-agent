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

  const brdContext = ctx.preparedChunks
    .map((c) => `### ${c.title} (${c.sourceType})\n${c.content}`)
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
    ? `\n\n### ÖRNEK ŞABLON KILAVUZ — BU FORMAT VE ÜSLUBA UY\n\nAşağıdaki örnek dökümanı dikkatle incele. Senin yazacağın kılavuz **bu dökümanın anlatım üslubu, paragraf-cümle yapısı, başlık tarzı ve detay seviyesinde** olmalı. İçeriği KOPYALAMA — sadece formu örnek al.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} ---\n${t.slice(0, 8000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n\nÖZELLIKLE DİKKAT ET:\n- Şablon adımları nasıl numaralandırıyor → aynı şekilde yap\n- Şablon ne kadar açıklayıcı (her butonu ayrı paragraf mı, kısa madde mi)\n- Şablonun \"sen/siz\" hitabı nasıl → onu kullan\n- Şablonda kullanılan terimleri (örn: 'panel', 'sekme', 'kayıt') benimse\n`
    : "";

  const stateCount = (ctx.screen.states ?? []).length;
  const stateBlock = stateCount > 0
    ? `\n\nSAHNANA TOPLAM ${stateCount + 1} GÖRSEL VERİLDİ:\n  Görsel #1: Ana ekran\n${(ctx.screen.states ?? []).map((s, i) => `  Görsel #${i + 2}: ${s.label} — (${s.triggeredBy})`).join("\n")}\n\nBu görselleri kullanarak:\n- 'Adım Adım Kullanım' bölümünde her akışın hangi state'lerden geçtiğini doğal cümlelerle anlat (örn: 'Filters butonuna tıkladığında ekranın üst kısmında bir filtre paneli açılır — burada şu alanları görürsün…')\n- 'Modallar ve Yan Paneller' bölümünde her modal'ı ayrı alt başlık altında ele al: ne zaman açılır, içinde ne var, nasıl tamamlanır\n- 'Satır Üzerindeki İşlemler'de kebab/aksiyon menüsündeki tüm seçenekleri sırayla anlat\n\nUNUTMA: BİR KULLANICI KILAVUZU YAZIYORSUN, teknik bir doküman değil. Bileşen tablosu, açık sorular, hiyerarşi gibi teknik bölümler EKLEME.\n`
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
