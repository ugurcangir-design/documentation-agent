import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude, isPromptTooLong } from "../llm/claudeClient";
import { selectRepresentativeStates } from "./selectStates";
import { isSidebarNav } from "../quality/sidebarNav";
import type { ScreenState } from "../types/screen";
import { groupStatesByTab } from "./tabGrouping";

export interface GenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
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
export interface StateImageRef {
  n: number;
  label: string;
  triggeredBy: string;
  url: string;
}

/**
 * Görsel embed bloğunu kurar. KRİTİK: ekranın hiç state'i olmasa bile
 * **en azından ana ekran görseli** her zaman embed talimatına girer —
 * aksi halde (eski hata) state'siz ekranlarda görsel tablosu komple
 * düşüyor, model görseli vision'da görse de gömmüyor → ekran görüntüsüz,
 * eksik kılavuz. `mainImgUrl` null ise (ana görsel yok) yalnız state'ler;
 * hiç görsel yoksa boş döner.
 */
export function buildScreenshotEmbedBlock(
  mainImgUrl: string | null,
  stateImageList: StateImageRef[],
  screenPath: string
): string {
  const hasMain = !!mainImgUrl;
  const stateCount = stateImageList.length;
  const totalImages = (hasMain ? 1 : 0) + stateCount;
  if (totalImages === 0) return "";

  const minEmbeds = Math.min(totalImages, 12);

  const rows: string[] = [];
  if (hasMain) rows.push(`| 1 | Ana ekran | (sayfa açılışı) | \`![Ana ekran](${mainImgUrl})\` |`);
  for (const s of stateImageList) {
    rows.push(`| ${s.n} | ${s.label} | ${s.triggeredBy} | \`![${s.label}](${s.url})\` |`);
  }
  const imageTable =
    `| # | Etiket | Tetikleyici | Embed kodu |\n|---|---|---|---|\n` + rows.join("\n");

  const placement = stateCount > 0
    ? `**Yerleştirme:**\n` +
      `- Ana ekran görseli → 'Ekrana İlk Bakış' ilk paragraftan sonra\n` +
      `- 'Sekme:' içeren görseller → EKRANDAKİ HER SEKME AYRI BİR '### <Sekme Adı> Sekmesi' ALT BAŞLIĞI olur. Sekmeleri görseldeki SOLDAN SAĞA SIRAYLA anlat. Her sekme için SADECE 'bu sekme var' DEME — o sekmenin görselindeki tüm alanları, tabloları, butonları, filtreleri ve ne işe yaradığını adım adım detaylandır. Her sekme kendi mini-kılavuzu gibi olmalı.\n` +
      `- 'Filtre' / 'Filters' içeren görsel → 'Filtreler ve Arama Seçenekleri' başlığı altı + filtre alanlarını TEK TEK anlat\n` +
      `- 'Modal' veya 'Panel/etki' ile başlayan görseller → 'Modallar ve Yan Paneller' alt başlıklarında, içindeki TÜM form alanlarını anlat\n` +
      `- '(dolu)' veya 'Form dolu' içeren görseller → ilgili formun ALTINDA 'Örnek Veri Girişi' diye numaralı adımlar yaz: her alana NE girileceğini görseldeki örnek değerlerle göster (örn. \"1. **Ad** alanına firma adını girin (örn: Örnek Ad)\"). Bu görseller test verisiyle doldurulmuş gerçek hâli gösterir — kılavuzu bu somut örnek üzerinden adım adım anlat.\n` +
      `- 'doğrulama uyarısı' içeren görseller → 'Doğrulama ve Hata Mesajları' başlığında: zorunlu/geçersiz alan bırakılırsa kullanıcının göreceği uyarıyı ve nasıl düzelteceğini anlat.\n` +
      `- 'Filtre/arama sonucu' içeren görseller → filtre anlatımının sonunda 'Sonuçların Görüntülenmesi': filtre uygulandıktan sonra listenin nasıl güncellendiğini göster.\n` +
      `- 'Kayıt sonrası' içeren görseller → ilgili kaydetme akışının SONUNDA 'Kaydetme ve Sonrası': Kaydet'e basıldıktan sonra ne olur (başarı mesajı, modalın kapanması, listeye dönüş) anlat.\n` +
      `- 'Sıralama' / kolon header → 'Tablo / Liste Görünümü' içinde\n` +
      `- 'Satır aksiyon' → 'Satır Üzerindeki İşlemler' içinde, menüdeki tüm seçenekleri listele\n` +
      `- Diğer state'ler (toggle, checkbox, input, tooltip, dropdown) → ilgili oldukları bölüm\n`
    : `**Yerleştirme:**\n` +
      `- Ana ekran görselini 'Ekrana İlk Bakış' bölümünün ilk paragrafından sonra MUTLAKA embed et.\n`;

  return (
    `\n\n# ${totalImages} GÖRSEL VERİLDİ — TAMAMINI EMBED ET\n\n${imageTable}\n\n` +
    placement +
    `\n**Kural:** En az ${minEmbeds} embed. Path'leri AYNEN yukarıdaki tablodaki gibi kullan. ` +
    `EKRAN GÖRÜNTÜSÜ OLMADAN KILAVUZ YAZMA — en azından ana ekran görselini embed etmek ZORUNLUDUR.\n` +
    `**Anlatım düzeni (ÇOK ÖNEMLİ):** Her görseli, o görselin NE gösterdiğini/hangi adım olduğunu anlatan açıklamanın HEMEN ALTINA koy. ASLA iki veya daha fazla görseli arka arkaya (aralarında açıklama olmadan) yığma. Akış şöyle olmalı: önce adımı yaz ("1. Şu butona tıklayın…"), sonra o adımın görselini embed et, sonra sonucu açıkla, sonra bir sonraki adım… Bir insanın ekranı adım adım kullanıp her ekranı göstererek anlatması gibi. Görsel yığını + tüm açıklama en üstte/altta = YANLIŞ.\n\n` +
    `**Yasak — global sayfa şablonu:** Görsellerde sol sidebar menüsü (başka sayfalara giden linkler) ve üst bardaki **profil/hesap menüsü, dil seçici (Türkçe/English), bildirim zili, oturumu kapat** gibi kontroller görünebilir — bunlar bu ekranın değil, uygulamanın GENEL ŞABLONUNUN parçasıdır. URL'i ${screenPath} olan bu ekranı anlatırken bunları BAHSETME, listeleme, görsellerini embed ETME.\n`
  );
}

function buildPrompt(
  ctx: ScreenContext,
  templates: string[],
  tabFocus?: { label: string }
): { cachedPrefix: string; prompt: string } {
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

  const stateBlock = buildScreenshotEmbedBlock(
    ctx.screen.screenshotPath ? mainImgUrl : null,
    stateImageList,
    ctx.screen.path
  );

  // Job-stable prefix — bu metin aynı job içinde her ekran için byte-byte
  // aynıdır → cache hit. Header + (varsa) şablon bloğu + output structure
  // + kurallar burada.
  const cachedPrefix = [
    buildPromptHeader(cfg),
    templateBlock,
    buildPromptFooter(cfg),
  ].filter((s) => s && s.trim().length > 0).join("\n\n");

  // Per-screen dynamic prompt — retrieval + ekran-spesifik içerik.
  const finalInstruction = tabFocus
    ? `Bu çıktı, '${ctx.analysis.screenTitle}' ekranının **'${tabFocus.label}' SEKMESİNE** ait bölümdür.
- Çıktı SADECE \`## ${tabFocus.label} Sekmesi\` markdown başlığıyla başlasın. Ekranın genel girişini/başlığını TEKRARLAMA (o ayrı ana bölümde yazıldı).
- YALNIZCA bu sekmeye ait, sana verilen sekme görsellerinde görünen alanları, butonları, tabloları, filtreleri, modalları, popup/alert ve mesajları anlat. Diğer sekmeleri anlatma.
- Aşağıdaki 5 boyutlu eksiksizlik bu sekme için de ZORUNLU: her adım numaralı, her modal/mesaj kendi görseliyle, veri girişi somut örnekli.
- Bu sekmeye ait HİÇBİR işlem, alan, buton, mesaj veya detay atlanmasın.`
    : `Bu ekran için KULLANICI KILAVUZU yaz. Kullanıcı sadece bu dökümana bakarak ekrandaki her butona, alana, filtreye, satır işlemine, SEKMEYE hakim olabilmeli. Hiçbir UI öğesi atlanmamalı.`;

  const prompt = `**Ekran:** ${ctx.analysis.screenTitle} · ${ctx.screen.path}${tabFocus ? `\n**Aktif Sekme:** ${tabFocus.label}` : ""}
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

${finalInstruction}

EKSİKSİZLİK ZORUNLU — şu beş boyutta hiçbir şey atlama:
1. **Ekran görüntüsü:** Her ana adım/sekme/modal için ilgili görseli embed et (yukarıdaki tablo). Görselsiz adım anlatma.
2. **İşlem adımları:** Her akışı NUMARALI adımlarla anlat (1, 2, 3…): hangi öğeye tıklanır, hangi alana ne girilir, hangi sırayla. "Şunu yapabilirsiniz" gibi muğlak değil; "1. X butonuna tıklayın → 2. açılan formda Y alanına … girin → 3. Kaydet'e basın" gibi somut.
3. **Sekmeler:** Ekranda sekme varsa her birini SOLDAN SAĞA SIRAYLA, ayrı alt başlıkla, kendi alanları/tabloları/aksiyonlarıyla detaylandır.
4. **Ekran mesajları:** Doğrulama uyarıları, başarı/hata bildirimleri, onay diyalogları — hangi durumda hangi mesajın çıktığını ve kullanıcının ne yapması gerektiğini yaz (ilgili görseller verildiyse onlardan).
5. **Veri girişi:** Form alanlarına somut örnek değerlerle (dolu form görsellerindeki gibi); zorunlu/opsiyonel alanlar ve biçim kuralları (tarih, telefon, e-posta) belirtilir.

Amaç: Kullanıcı bu ekranı baştan sona, tek bir işlemi/bilgiyi/detayı kaçırmadan kullanabilsin. Atlanan her öğe eksik kılavuz demektir.`;

  return { cachedPrefix, prompt };
}

export interface ManualFocus {
  /** Bu çağrı için kullanılacak state alt-kümesi (örn. tek bir sekmenin
   *  görselleri). Verilmezse ctx.screen.states kullanılır. */
  statesOverride?: ScreenState[];
  /** Sekme bölümü üretiliyorsa sekmenin adı (çıktı '## <ad> Sekmesi'). */
  tabLabel?: string;
}

export async function generateUserManualSection(
  ctx: ScreenContext,
  templates: string[] = [],
  focus?: ManualFocus
): Promise<GenerationResult> {
  const cfg = loadPromptConfig("userManual");

  const sourceStates = focus?.statesOverride ?? ctx.screen.states ?? [];
  const allStates = selectRepresentativeStates(sourceStates);
  const tabFocus = focus?.tabLabel ? { label: focus.tabLabel } : undefined;

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
    const { cachedPrefix, prompt } = buildPrompt(trimmedCtx, useTemplates, tabFocus);
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
      cacheReadTokens: result.cacheReadTokens ?? 0,
      cacheCreationTokens: result.cacheCreationTokens ?? 0,
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

/** İki GenerationResult'ı (içerik + token) birleştirir. */
function mergeResults(a: GenerationResult, b: GenerationResult, joiner = "\n\n"): GenerationResult {
  const out: GenerationResult = {
    content: a.content + joiner + b.content,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheCreationTokens: (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0),
  };
  if (a.truncated || b.truncated) out.truncated = true;
  return out;
}

/**
 * Tam kullanıcı kılavuzu — çok sekmeli ekranlarda KAYIPSIZ üretim.
 * Ekranda ≥2 sekme varsa: önce genel-bakış bölümü (sekme-dışı state'ler),
 * sonra HER SEKME için AYRI üretim çağrısı (yalnız o sekmenin görselleriyle)
 * yapılır ve tek dokümanda birleştirilir. Böylece her sekmenin kendi tam
 * görsel/işlem seti modele girer; tek çağrının görsel bütçesine sıkışıp
 * sekme detayı kaybolmaz. Tek sekme / sekmesiz ekranlarda tek çağrı.
 */
export async function generateUserManualComplete(
  ctx: ScreenContext,
  templates: string[] = []
): Promise<GenerationResult> {
  const { baseStates, tabs } = groupStatesByTab(ctx.screen.states ?? []);

  // Tek sekme ya da hiç sekme yok → mevcut tek-çağrı akışı (tüm state'ler).
  if (tabs.length < 2) {
    return generateUserManualSection(ctx, templates);
  }

  console.log(`[userManual] ${tabs.length} sekme tespit edildi → sekme başına ayrı üretim + birleştirme`);

  // 1. Genel bakış — sekmeye ait olmayan state'lerle (ana görsel + ortak alanlar).
  const overviewCtx: ScreenContext = { ...ctx, screen: { ...ctx.screen, states: baseStates } };
  let merged = await generateUserManualSection(overviewCtx, templates);

  // 2. Her sekme için ayrı, odaklı bölüm üret ve ekle.
  for (const tab of tabs) {
    try {
      const section = await generateUserManualSection(ctx, templates, {
        statesOverride: tab.states,
        tabLabel: tab.label,
      });
      merged = mergeResults(merged, section, "\n\n---\n\n");
      console.log(`[userManual]   ✓ '${tab.label}' sekmesi bölümü üretildi (${tab.states.length} görsel)`);
    } catch (e) {
      console.warn(`[userManual]   ✗ '${tab.label}' sekmesi üretilemedi: ${(e as Error).message}`);
    }
  }

  return merged;
}
