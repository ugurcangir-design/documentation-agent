import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude } from "../llm/claudeClient";
import type { GenerationResult } from "./userManualGenerator";

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
    ? `\n\n### Örnek Şablon (yapı referansı)\n\nDikkat: Aşağıdaki şablon kullanıcı kılavuzu olabilir — TEKNİK dökümanını şablonun tarzında değil, kendi başına teknik referans olarak yaz. Şablonu sadece terminoloji çıkarımı için kullanabilirsin.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} (sadece sözlük olarak kullan) ---\n${t.slice(0, 4000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n`
    : "";

  const stateCount = (ctx.screen.states ?? []).length;
  const stateBlock = stateCount > 0
    ? `\n\nSANA TOPLAM ${stateCount + 1} GÖRSEL VERİLDİ — 1 ana ekran + ${stateCount} test user simülasyon state'i. Etiketler:\n${(ctx.screen.states ?? []).map((s, i) => `  Görsel #${i + 2}: ${s.label} — (${s.triggeredBy})`).join("\n")}\n\nBu görsellerden:\n- 'Veri Tablosu' bölümünde kolon spesifikasyonlarını çıkar\n- 'Filtreleme Mekanizması' bölümünde filtre alanlarının davranışını yaz\n- 'Form ve Modal Spec'leri' bölümünde her modal'ın alan listesini ver\n- 'API Bağlantıları' bölümünde Swagger context'inden eşleştirme yap\n\nKullanıcı kılavuzunda anlatılan akışları TEKRAR YAZMA — sadece teknik spesifikasyon olarak listele.\n`
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
${stateBlock}${templateBlock}
---

Bu ekran için TEKNİK DÖKÜMAN bölümü yaz. Geliştirici ve sistem analisti hedef kitlesi.

${buildPromptFooter(cfg)}`;
}

export async function generateTechnicalDocSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("technicalDoc");
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
