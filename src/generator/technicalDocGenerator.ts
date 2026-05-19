import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude } from "../llm/claudeClient";
import { selectRepresentativeStates } from "./selectStates";
import type { GenerationResult } from "./userManualGenerator";

function buildPrompt(ctx: ScreenContext, templates: string[]): string {
  const cfg = loadPromptConfig("technicalDoc");

  const brdContext = ctx.preparedChunks
    .map((c) => `### ${c.title} (${c.sourceType})\n${c.content}`)
    .join("\n\n");

  const paragraphContext = ctx.paragraphMatches.length > 0
    ? "\n\n### BRD İlave Paragraflar (long-tail)\n" +
      ctx.paragraphMatches.map((m) => `> _[${m.sectionTitle}]_ ${m.paragraph}`).join("\n\n")
    : "";

  const apiContext = ctx.relatedEndpoints
    .map((r) => `- [${r.endpoint.method}] ${r.endpoint.path} — ${r.endpoint.summary || ""} (service: ${r.endpoint.serviceName})`)
    .join("\n");

  // Same sidebar/nav filter as the user manual generator — these point
  // to other screens and must not appear in this screen's tech doc.
  const SIDEBAR_NAV_HINTS = [
    "sport base data", "sports", "categories", "competitions", "market setup",
    "priority settings", "venues", "competitors", "heroes", "multi feed",
    "sport mapping", "market mapping", "definitions", "event management",
    "outright program", "live program", "newspaper program", "v-sport program",
    "exported program", "groups", "outright", "settings", "logout", "çıkış",
  ];
  const isSidebarNav = (el: { label: string; type: string }) => {
    const lbl = el.label.toLowerCase().trim();
    if (el.type === "menu") return true;
    return SIDEBAR_NAV_HINTS.some((h) => lbl === h || lbl.startsWith(h + " "));
  };
  const inScopeElements = ctx.analysis.uiElements.filter((el) => !isSidebarNav(el));

  const uiElements = inScopeElements
    .map((el) => `- ${el.type}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");

  const templateBlock = templates.length > 0
    ? `\n\n### Örnek Şablon (yapı referansı)\n\nDikkat: Aşağıdaki şablon kullanıcı kılavuzu olabilir — TEKNİK dökümanını şablonun tarzında değil, kendi başına teknik referans olarak yaz. Şablonu sadece terminoloji çıkarımı için kullanabilirsin.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} (sadece sözlük olarak kullan) ---\n${t.slice(0, 4000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n`
    : "";

  const representativeStates = selectRepresentativeStates(ctx.screen.states ?? []);
  const stateCount = representativeStates.length;
  const stateBlock = stateCount > 0
    ? `\n\nSANA TOPLAM ${stateCount + 1} GÖRSEL VERİLDİ — 1 ana ekran + ${stateCount} test user simülasyon state'i. Etiketler:\n${representativeStates.map((s, i) => `  Görsel #${i + 2}: ${s.label} — (${s.triggeredBy})`).join("\n")}\n\nBu görsellerden:\n- 'Veri Tablosu' bölümünde kolon spesifikasyonlarını çıkar\n- 'Filtreleme Mekanizması' bölümünde filtre alanlarının davranışını yaz\n- 'Form ve Modal Spec'leri' bölümünde her modal'ın alan listesini ver\n- 'API Bağlantıları' bölümünde Swagger context'inden eşleştirme yap\n\nKullanıcı kılavuzunda anlatılan akışları TEKRAR YAZMA — sadece teknik spesifikasyon olarak listele.\n`
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
${brdContext || "(Yok)"}${paragraphContext}

İlgili API Endpoint'leri:
${apiContext || "(Yok)"}
${stateBlock}${templateBlock}
---

# KAPSAM
Aşağıdaki ${inScopeElements.length} UI bileşeni ekranda tespit edildi. Her birine **Bileşen Envanteri tablosunda bir satır ayır**:

${inScopeElements.map((el, i) => `${i + 1}. ${el.label} (${el.type})`).join("\n")}

# SIDEBAR / NAVİGASYON YASAĞI
Görsellerde sol kenar çubuğunda 'Sport Base Data', 'Sports', 'Categories' vb. global navigasyon öğeleri görebilirsin — BUNLAR BU EKRANIN PARÇASI DEĞİL, başka sayfalara gider. Teknik dökümanda bunlara değinme. Yalnızca URL'i ${ctx.screen.path} olan ekrana özgü bileşenleri spec'leme.

Bu ekran için TEKNİK DÖKÜMAN yaz. Geliştirici sayfayı sıfırdan inşa edebilsin, QA test case çıkarabilsin.

${buildPromptFooter(cfg)}`;
}

export async function generateTechnicalDocSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("technicalDoc");
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
