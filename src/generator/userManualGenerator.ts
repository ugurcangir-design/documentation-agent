import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude, isPromptTooLong } from "../llm/claudeClient";
import { selectRepresentativeStates } from "./selectStates";
import { isSidebarNav } from "../quality/sidebarNav";

export interface GenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  /** True when Claude hit max_tokens — doküman muhtemelen yarım kaldı. */
  truncated?: boolean;
}

/**
 * Prompt'u iki parçaya böler — `cachedPrefix` (rol + output structure +
 * kurallar + şablonlar; aynı job içinde tüm ekranlarda byte-byte aynı,
 * Anthropic ephemeral cache ile %~90 input token tasarrufu sağlar) ve
 * `prompt` (ekran-spesifik retrieve sonuçları, UI öğeleri, akışlar,
 * state görsel tablosu, son talimat).
 *
 * Cache hit minimum ~1024 token gerektirir; şablonlar yoksa prefix
 * küçük kalır ve cache devreye girmeyebilir (zararı yoktur).
 */
function buildPrompt(ctx: ScreenContext, templates: string[]): { cachedPrefix: string; prompt: string } {
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

  // Sidebar/global nav öğeleri başka ekranlara gider — bu ekranın
  // parçası değil. Tek kaynak: quality/sidebarNav.
  const inScopeElements = ctx.analysis.uiElements.filter((el) => !isSidebarNav(el));

  // Single numbered list that serves BOTH as context AND as the
  // coverage-required checklist (eliminates ~750-byte duplication).
  const uiElementsBlock = inScopeElements
    .map((el, i) =>
      `${i + 1}. **${el.label}** (${el.type}) — ${el.description}${el.action ? ` → ${el.action}` : ""}`
    )
    .join("\n");

  // Single workflow listing with steps inline (eliminates duplicate
  // workflow header list).
  const workflowsBlock = ctx.analysis.workflows
    .map((wf, i) =>
      `${i + 1}. **${wf.name}**${wf.trigger ? ` _(tetikleyici: ${wf.trigger})_` : ""}\n` +
      wf.steps.map((s) => `   - ${s}`).join("\n")
    )
    .join("\n");

  const templateBlock = templates.length > 0
    ? `\n\n### ÖRNEK ŞABLON KILAVUZ — BU FORMAT VE ÜSLUBA UY\n\nAşağıdaki örnek dökümanı dikkatle incele. Senin yazacağın kılavuz **bu dökümanın anlatım üslubu, paragraf-cümle yapısı, başlık tarzı ve detay seviyesinde** olmalı. İçeriği KOPYALAMA — sadece formu örnek al.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1} ---\n${t.slice(0, 7000)}`).join("\n\n")}\n--- ŞABLON SONU ---\n\nÖZELLIKLE DİKKAT ET:\n- Şablon adımları nasıl numaralandırıyor → aynı şekilde yap\n- Şablon ne kadar açıklayıcı (her butonu ayrı paragraf mı, kısa madde mi)\n- Şablonun \"sen/siz\" hitabı nasıl → onu kullan\n- Şablonda kullanılan terimleri (örn: 'panel', 'sekme', 'kayıt') benimse\n`
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

  // Single compact image catalog — used both for context (list) and
  // for embed enforcement. No more duplicate state-image listings.
  const stateCount = stateImageList.length;
  const minEmbeds = Math.max(6, Math.min(stateCount + 1, 12));

  const imageTable =
    `| # | Etiket | Tetikleyici | Embed kodu |\n` +
    `|---|---|---|---|\n` +
    `| 1 | Ana ekran | (sayfa açılışı) | \`![Ana ekran](${mainImgUrl})\` |\n` +
    stateImageList
      .map((s) => `| ${s.n} | ${s.label} | ${s.triggeredBy} | \`![${s.label}](${s.url})\` |`)
      .join("\n");

  const stateBlock = stateCount > 0
    ? `\n\n# ${stateCount + 1} GÖRSEL VERİLDİ — TAMAMINI EMBED ET\n\n${imageTable}\n\n` +
      `**Yerleştirme:**\n` +
      `- Görsel 1 → 'Ekrana İlk Bakış' ilk paragraftan sonra\n` +
      `- 'Filtre' / 'Filters' içeren görsel → 'Filtreler ve Arama Seçenekleri' başlığı altı + filtre alanlarını TEK TEK anlat\n` +
      `- 'Modal' veya 'Panel/etki' ile başlayan görseller → 'Modallar ve Yan Paneller' alt başlıklarında, içindeki TÜM form alanlarını anlat\n` +
      `- 'Sıralama' / kolon header → 'Tablo / Liste Görünümü' içinde\n` +
      `- 'Satır aksiyon' → 'Satır Üzerindeki İşlemler' içinde, menüdeki tüm seçenekleri listele\n` +
      `- Diğer state'ler (toggle, checkbox, input, tooltip, dropdown) → ilgili oldukları bölüm\n\n` +
      `**Kural:** En az ${minEmbeds} embed. Path'leri AYNEN yukarıdaki tablodaki gibi kullan.\n\n` +
      `**Yasak:** Görsellerde sol sidebar'da 'Sport Base Data', 'Sports', 'Categories', 'Multi Feed Settings' vb. olabilir — bunlar GLOBAL NAV, başka sayfalara gider. URL'i ${ctx.screen.path} olan bu ekranın parçası DEĞİL. Bahsetme, listeleme.\n`
    : "";

  // Job-stable prefix — bu metin aynı job içinde her ekran için byte-byte
  // aynıdır → cache hit. Header + (varsa) şablon bloğu + output structure
  // + kurallar burada.
  const cachedPrefix = [
    buildPromptHeader(cfg),
    templateBlock,
    buildPromptFooter(cfg),
  ].filter((s) => s && s.trim().length > 0).join("\n\n");

  // Per-screen dynamic prompt — retrieval + ekran-spesifik içerik.
  const prompt = `**Ekran:** ${ctx.analysis.screenTitle} · ${ctx.screen.path}
**Amaç:** ${ctx.analysis.purpose}
**Hedef kullanıcı:** ${ctx.analysis.targetAudience || "Genel kullanıcı"}

# UI ÖĞELERİ — HEPSİNİ KILAVUZDA İŞLE (${inScopeElements.length} adet, sidebar/global nav hariç)

${uiElementsBlock}

# İŞ AKIŞLARI — HER BİRİ İÇİN 'ADIM ADIM KULLANIM' ALTINA ALT BAŞLIK AÇ (${ctx.analysis.workflows.length} adet)

${workflowsBlock || "_(akış tespit edilmedi — 3-5 ana akışı görsellerden çıkar)_"}

# BRD / CONFLUENCE BAĞLAMI

${brdContext || "_(yok)_"}${paragraphContext}

# API ENDPOINT'LERİ

${apiContext || "_(yok)_"}
${stateBlock}
---

Bu ekran için KULLANICI KILAVUZU yaz. Kullanıcı sadece bu dökümana bakarak ekrandaki her butona, alana, filtreye, satır işlemine hakim olabilmeli. Hiçbir UI öğesi atlanmamalı.`;

  return { cachedPrefix, prompt };
}

export async function generateUserManualSection(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("userManual");

  const allStates = selectRepresentativeStates(ctx.screen.states ?? []);

  async function runWithBudget(stateCap: number, tmplChars: number): Promise<GenerationResult> {
    const useStates = allStates.slice(0, stateCap);
    const useTemplates = templates.map((t) => t.slice(0, tmplChars));
    const trimmedCtx: ScreenContext = {
      ...ctx,
      screen: { ...ctx.screen, states: useStates },
    };
    const stateImages = useStates.map((s) => ({
      base64: s.screenshotBase64,
      path: s.screenshotPath,
      label: s.label,
    }));
    const { cachedPrefix, prompt } = buildPrompt(trimmedCtx, useTemplates);
    const result = await callClaude({
      prompt,
      cachedPrefix,
      imageBase64: ctx.screen.screenshotBase64,
      imagePath: ctx.screen.screenshotPath,
      images: stateImages,
      maxTokens: cfg.maxTokens ?? 8000,
    });
    const out: GenerationResult = {
      content: cleanGeneratedMarkdown(result.text),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
    if (result.truncated) out.truncated = true;
    return out;
  }

  // First try with full budget; if Claude rejects with 'prompt too long',
  // back off through 2 reduced tiers so we still produce a document.
  try {
    return await runWithBudget(allStates.length, 7000);
  } catch (err) {
    if (!isPromptTooLong(err)) throw err;
    console.warn("[userManual] prompt too long — retrying with reduced context");
    try {
      return await runWithBudget(Math.max(5, Math.floor(allStates.length / 2)), 3500);
    } catch (err2) {
      if (!isPromptTooLong(err2)) throw err2;
      console.warn("[userManual] still too long — minimal context");
      return await runWithBudget(4, 1500);
    }
  }
}
