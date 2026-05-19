import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude, isPromptTooLong } from "../llm/claudeClient";
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

  // Filter out sidebar/header navigation menu items even if the analyzer
  // accidentally included them. These point to other screens and must
  // not appear in this screen's manual.
  const SIDEBAR_NAV_HINTS = [
    "sport base data", "sports", "categories", "competitions", "market setup",
    "priority settings", "venues", "competitors", "heroes", "multi feed",
    "sport mapping", "market mapping", "definitions", "event management",
    "outright program", "live program", "newspaper program", "v-sport program",
    "exported program", "groups", "outright", "live program", "settings",
    "ürünler", "users", "settings", "logout", "çıkış",
  ];
  const isSidebarNav = (el: { label: string; type: string }) => {
    const lbl = el.label.toLowerCase().trim();
    if (el.type === "menu") return true;
    return SIDEBAR_NAV_HINTS.some((h) => lbl === h || lbl.startsWith(h + " ") || lbl === `${h}`);
  };

  const inScopeElements = ctx.analysis.uiElements.filter((el) => !isSidebarNav(el));

  const uiElements = inScopeElements
    .map((el) => `- ${el.type.toUpperCase()}: "${el.label}" — ${el.description}${el.action ? ` → ${el.action}` : ""}`)
    .join("\n");

  // Coverage list also excludes sidebar nav so the model isn't pushed
  // to document irrelevant items.
  const coverageList = inScopeElements
    .map((el, i) => `${i + 1}. "${el.label}" (${el.type})`)
    .join("\n");
  const workflowList = ctx.analysis.workflows
    .map((wf, i) => `${i + 1}. ${wf.name}`)
    .join("\n");

  const workflows = ctx.analysis.workflows
    .map((wf) => `**${wf.name}**${wf.trigger ? ` (Tetikleyici: ${wf.trigger})` : ""}:\n${wf.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`)
    .join("\n\n");

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
    ? `\n\nSANA TOPLAM ${stateCount + 1} GÖRSEL VERİLDİ:\n  Görsel #1: Ana ekran\n${stateImageList.map(s => `  Görsel #${s.n}: ${s.label} — (${s.triggeredBy})`).join("\n")}\n\n${imageCatalog}\n\n# GÖRSEL EKLEME KURALI — UYULMAZSA KILAVUZ EKSİK SAYILIR\n\nTÜM ${stateCount + 1} GÖRSELİ kılavuza markdown image syntax ile **EMBED ETMEK ZORUNDASIN** (sadece bahsetmek YETERSİZ).\n\nZORUNLU EŞLEME:\n1. **Ana ekran** (Görsel #1) → 'Ekrana İlk Bakış' bölümünün İLK PARAGRAFINDAN HEMEN SONRA embed et.\n2. **Filtre paneli açık state'i** (label'ı 'Filtre paneli' veya 'Filters' içeren görsel) → 'Filtreler ve Arama Seçenekleri' başlığının altına embed et. Ardından filtrelerdeki HER alanı (Event ID, Provider, Sport, Category, Match Status, vb.) görseldeki ipuçlarına göre tek tek açıkla.\n3. **Modal/dialog state'leri** (label'ı 'Modal' veya 'Panel/etki' ile başlayan görseller — örn: Add Manual Event, Edit & Details, Action Log) → 'Modallar ve Yan Paneller' altındaki ilgili alt başlığa embed et. Modal'ın içindeki TÜM form alanlarını, butonları, validasyon mesajlarını anlat.\n4. **Sıralama / kolon header state'leri** → 'Tablo / Liste Görünümü' kısmında embed et.\n5. **Satır aksiyon menüsü state'leri** → 'Satır Üzerindeki İşlemler' bölümünde embed et, menüde çıkan TÜM seçenekleri listele.\n6. **Diğer kalan state'ler** (toggle, checkbox, input focus, tooltip, dropdown) → ilgili oldukları bölümde embed et.\n\nKURALLAR:\n- Görselleri AYNEN yukarıdaki listedeki '/screenshots/...' path'leriyle kullan.\n- Embed sayısı en az ${Math.max(6, Math.min(stateCount + 1, 12))} olmalı.\n- 'Adım adım kullanım' içindeki her akışta, o akışın hangi state(ler)den geçtiğini görselle göster.\n\n# SIDEBAR / NAVİGASYON YASAĞI\n\nGörsellerde sol kenar çubuğunda 'Sport Base Data', 'Sports', 'Categories', 'Competitions', 'Market Setup', 'Multi Feed Settings', 'Event Management' gibi öğeler görebilirsin. **BUNLAR BU EKRANIN PARÇASI DEĞİL** — uygulamanın global navigasyonudur ve diğer ekranlara gider. Bunlara değinme, listeleme, açıklamaya çalışma. Yalnızca ana içerik alanındaki (URL'i ${ctx.screen.path} olan ekrana özgü) işlevselliği belgele.\n`
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

Aşağıdaki ${inScopeElements.length} UI öğesi bu ekranın ANA İÇERİĞİNDE tespit edildi (sidebar/header nav öğeleri çıkarıldı). Kılavuzun bir yerinde **her birinden bahsetmek zorundasın** (envanter tablosu olarak değil, akışlar/bölümler içinde doğal anlatımla):

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
    const result = await callClaude({
      prompt: buildPrompt(trimmedCtx, useTemplates),
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
