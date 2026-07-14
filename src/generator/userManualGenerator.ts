import { ScreenContext } from "../types/documentation";
import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { loadPromptConfig, buildPromptHeader, buildPromptFooter } from "../config/promptConfig";
import { callClaude, isPromptTooLong, isUsageLimitError, MODEL_QUALITY } from "../llm/claudeClient";
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
  /** Çok-sekmeli üretimde (≥2 sekme) genel bakış bölümü — ayrık tutulur ki
   *  coverage + fix-up YALNIZ burada çalışsın (sekme bölümleri yeniden
   *  yazılmaz; ~8× token tasarrufu). Tek/sıfır sekmede undefined. */
  overviewContent?: string;
  /** Çok-sekmeli üretimde birleştirilmiş sekme bölümleri (fix-up DOKUNMAZ). */
  tabsContent?: string;
  /** 2 denemeden sonra da üretilemeyen sekmelerin etiketleri — bu doküman
   *  bu sekmeler için EKSİK. screenProcessor bunu görünür bir uyarıya çevirir
   *  (sessiz kayıp değil). Yalnız ≥1 kalıcı hatada dolu döner. */
  failedTabs?: string[];
}

/** Genel bakış + sekme bölümlerini tek metinde birleştiren ayraç. */
export const SECTION_JOINER = "\n\n---\n\n";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  tabFocus?: { label: string },
  overviewTabs?: string[],
  liveAppEvidence?: string
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

  // YALIN MOD (sekme bölümleri): sekmeye göre değişmeyen AĞIR bağlamı
  // (16KB BRD/Confluence RAG + API endpoint'leri) sekme çağrılarından çıkar —
  // bu içerik GENEL BAKIŞ bölümüne aittir; sekme bölümleri görsellerden
  // anlatılır. ANCAK stil şablonu sekmelerde de KALMALI: aksi halde dokümanın
  // büyük kısmı (sekme bölümleri) örnek şablonun üslup/formatına benzemiyordu.
  // Sekmelerde şablon DAHA KISA tutulur (stil çapası yeter, tam metin gerekmez).
  const lean = !!tabFocus;
  const tmplLimit = lean ? 3500 : 7000;

  const templateBlock = templates.length === 0
    ? ""
    : `\n\n### ÖRNEK ŞABLON KILAVUZ — BU FORMAT VE ÜSLUBA UY\n\n${lean
        ? "Bu sekme bölümü, dökümanın genel bakış bölümüyle AYNI üsluba ve aşağıdaki örnek şablonun anlatım/format tarzına uymalı."
        : "Aşağıdaki örnek dökümanı dikkatle incele. Senin yazacağın kılavuz **bu dökümanın anlatım üslubu, paragraf-cümle yapısı, başlık tarzı ve detay seviyesinde** olmalı."} İçeriği KOPYALAMA — sadece formu örnek al.\n\n${templates.map((t, i) => `--- ŞABLON ${i + 1}${lean ? " (özet)" : ""} ---\n${t.slice(0, tmplLimit)}`).join("\n\n")}\n--- ŞABLON SONU ---\n\nÖZELLIKLE DİKKAT ET:\n- Şablon adımları nasıl numaralandırıyor → aynı şekilde yap\n- Şablon ne kadar açıklayıcı (her butonu ayrı paragraf mı, kısa madde mi)\n- Şablonun \"sen/siz\" hitabı nasıl → onu kullan\n- Şablonda kullanılan terimleri (örn: 'panel', 'sekme', 'kayıt') benimse\n`;

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

  // Sekme bölümünde ekranın ana keşif görseli gereksiz — sekmenin kendi
  // tam-sayfa görseli zaten state'lerde var. Ana görseli atla (token tasarrufu).
  const stateBlock = buildScreenshotEmbedBlock(
    ctx.screen.screenshotPath && !lean ? mainImgUrl : null,
    stateImageList,
    ctx.screen.path
  );

  // Job-stable prefix — bu metin aynı job içinde her ekran için byte-byte
  // aynıdır → cache hit. Header + (varsa) şablon bloğu + output structure
  // + kurallar burada.
  // Sekme bölümlerinde TAM çıktı yapısını (standart başlıklar) BASTIR —
  // aksi halde her sekme 'Filtreler', 'Modallar', 'Sık Sorular' gibi standart
  // bölümleri yeniden üretip dökümanı tekrarla dolduruyordu. Bu başlıklar
  // genel bakışta bir kez yer alır.
  const cachedPrefix = [
    buildPromptHeader(cfg),
    templateBlock,
    buildPromptFooter(cfg, { skipStructure: lean }),
  ].filter((s) => s && s.trim().length > 0).join("\n\n");

  // Per-screen dynamic prompt — retrieval + ekran-spesifik içerik.
  const finalInstruction = tabFocus
    ? `Bu çıktı, '${ctx.analysis.screenTitle}' ekranının **'${tabFocus.label}' SEKMESİNE** ait bölümdür.
- Çıktı SADECE \`## ${tabFocus.label} Sekmesi\` başlığıyla başlasın, tek bir odaklı bölüm olsun.
- YALNIZCA bu sekmeye ÖZGÜ içeriği anlat: bu sekmenin görsellerinde görünen filtreler, satır işlemleri (önizleme/düzenle/sil), butonlar, modallar, popup/alert ve mesajlar.
- **STANDART ALT BAŞLIKLAR — bu adları ve sırayı kullan (ekranda karşılığı olmayanı tamamen atla):**
  1. \`### Sütunlar\` — kısa madde listesi (sütun adı → içerik)
  2. \`### Sekmeye Özgü Filtreler\` — yalnız bu sekmede olan filtreler (varsa)
  3. \`### <İşlem Adı>\` — her işlem akışı (ekleme/düzenleme/silme/önizleme…) numaralı adımlarla AYRI alt başlık
  4. \`### Uyarı ve Hata Mesajları\` — bu sekmeye özgü, görsellerde görülen mesajlar (varsa)
  Başka ad türetme ('Tablo Görünümü', 'Tablo Sütunları' gibi varyasyonlar YASAK) — her sekmede aynı adlar kullanılacak.
- **TEKRAR YASAK:** Diğer sekmelerde de bulunan ORTAK/standart bölümleri burada ÜRETME — özellikle 'Bu Ekran Ne İşe Yarar?', 'Ekrana İlk Bakış', 'Sık Sorular ve İpuçları' bölümlerini EKLEME (bunlar genel bakışta bir kez yazıldı). Genel girişi/ekran tanıtımını tekrarlama.
- **EKRAN-GENELİ MEKANİKLER YASAK:** Sayfalama, 'sayfa başına kayıt sayısı' seçimi, tablo sıralama/arama gibi TÜM SEKMELERDE AYNI çalışan mekanikleri BURADA ANLATMA — bunlar dokümanın genel bakış bölümünde bir kez anlatıldı. Gerekirse tek cümleyle referans ver: "Sayfalama ve tablo kullanımı için Genel Bakış bölümüne bakın."
- **Tablo sütunları:** 'Tablo Görünümü' gibi genel bir bölüm YAZMA. Bu sekmenin tablosunun sütunlarını KISA bir madde listesi olarak ver (sütun adı → içerik); yalnızca bu sekmeye özgü sütun/davranış varsa onu vurgula. Sütunların genel davranışını (sıralama vb.) yeniden anlatma.
- Bu sekmenin diğer sekmelerden FARKLI olan içeriğine odaklan; her sekmede aynı olan genel bilgiyi yazma.
- Bu sekmeye ait hiçbir işlem/alan/buton/mesaj atlanmasın; her görsel kendi açıklamasının yanında.`
    : `Bu ekran için KULLANICI KILAVUZU yaz. Kullanıcı sadece bu dökümana bakarak ekrandaki her butona, alana, filtreye, satır işlemine, SEKMEYE hakim olabilmeli. Hiçbir UI öğesi atlanmamalı. 'Sık Sorular ve İpuçları' gibi ortak bölümler burada BİR KEZ yer alsın (sekme bölümlerinde tekrarlanmayacak).${overviewTabs && overviewTabs.length > 0 ? `

**ORTAK MEKANİKLER — BURADA BİR KEZ ANLAT:** Bu ekranda şu sekmeler var: ${overviewTabs.join(", ")}. Her sekme için AYRI bölümler ayrıca üretilecek; SEN yalnız genel bakışı yazıyorsun. TÜM SEKMELERDE ORTAK olan mekanikleri BURADA, net alt başlıklarla BİR KEZ anlat — sekme bölümleri bunları tekrarlamayacak, buraya referans verecek:
- Tablo kullanımı: sıralama, arama, kayıt görünümü (ortak sütunlar varsa burada listele)
- Sayfalama ve 'sayfa başına kayıt sayısı' seçimi (ekran geneli sabit bir kontrol — yalnız burada anlat)
- Tüm sekmelerde aynı çalışan filtre davranışı ve satır işlemleri (önizleme/düzenle/sil)` : ""}`;

  // Canlı uygulama kanıtı (opsiyonel, LIVE_APP_MCP_ENABLED) — Claude'un gerçek
  // ekranı MCP ile gezip gözlemlediği network/CRUD/mesaj kanıtı. Yalnız genel
  // bakışa girer (ağır bağlamla aynı ilke — sekmeler yalın kalır).
  const liveAppBlock = !lean && liveAppEvidence
    ? `\n\n# CANLI UYGULAMA GÖZLEMİ (MCP — gerçek ekran/network, EN GÜVENİLİR KAYNAK)\n\n${liveAppEvidence}`
    : "";

  // Sekme bölümlerinde ağır iş-bağlamı yok; yalnız hedefli paragraf
  // eşleşmeleri (küçük, doğruluğu artıran) korunur.
  const contextBlock = lean
    ? (paragraphContext ? `\n\n# İLGİLİ NOTLAR\n${paragraphContext}` : "")
    : `\n\n# BRD / CONFLUENCE BAĞLAMI\n\n${brdContext || "_(yok)_"}${paragraphContext}\n\n# API ENDPOINT'LERİ\n\n${apiContext || "_(yok)_"}${liveAppBlock}`;

  const prompt = `**Ekran:** ${ctx.analysis.screenTitle} · ${ctx.screen.path}${tabFocus ? `\n**Aktif Sekme:** ${tabFocus.label}` : ""}
**Amaç:** ${ctx.analysis.purpose}
**Hedef kullanıcı:** ${ctx.analysis.targetAudience || "Genel kullanıcı"}

# UI ÖĞELERİ — HEPSİNİ KILAVUZDA İŞLE (${inScopeElements.length} adet, sidebar/global nav hariç)

${uiElementsBlock}

# İŞ AKIŞLARI — HER BİRİ İÇİN 'ADIM ADIM KULLANIM' ALTINA ALT BAŞLIK AÇ (${ctx.analysis.workflows.length} adet)

${workflowsBlock || "_(akış tespit edilmedi — 3-5 ana akışı görsellerden çıkar)_"}${contextBlock}
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
  /** ÇOK-SEKMELİ ekranın GENEL BAKIŞ çağrısında sekme adları — prompt'a
   *  "ortak mekanikleri (sayfalama, sayfa-başına-kayıt, tablo kullanımı)
   *  burada BİR KEZ anlat" talimatı ekler; sekme bölümleri bunları
   *  tekrarlamak yerine buraya referans verir. */
  overviewTabs?: string[];
  /** Canlı uygulama kanıtı (MCP) — yalnız genel bakış çağrısında kullanılır,
   *  sekme çağrıları yalın kalır (bkz. liveAppMcp.ts). */
  liveAppEvidence?: string;
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
    const { cachedPrefix, prompt } = buildPrompt(trimmedCtx, useTemplates, tabFocus, focus?.overviewTabs, focus?.liveAppEvidence);
    const result = await callClaude({
      prompt,
      cachedPrefix,
      // Sekme bölümünde ekranın ana keşif görselini gönderme (sekmenin kendi
      // tam-sayfa görseli zaten `images` içinde) — vision token tasarrufu.
      ...(tabFocus ? {} : { imageBase64: ctx.screen.screenshotBase64, imagePath: ctx.screen.screenshotPath }),
      images: stateImages,
      maxTokens: cfg.maxTokens ?? 8000,
      model: MODEL_QUALITY,
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
  templates: string[] = [],
  onProgress?: (msg: string) => void,
  liveAppEvidence?: string
): Promise<GenerationResult> {
  const { baseStates, tabs } = groupStatesByTab(ctx.screen.states ?? []);

  // Tek sekme ya da hiç sekme yok → mevcut tek-çağrı akışı (tüm state'ler).
  if (tabs.length < 2) {
    return generateUserManualSection(ctx, templates, { ...(liveAppEvidence ? { liveAppEvidence } : {}) });
  }

  // Eşzamanlılık: bölümler PARALEL üretilir (süre kısalır). Token/kalite
  // ETKİLENMEZ — aynı prompt'lar, sıralı (genel bakış → tab0 → tab1 …)
  // birleştirme korunur. CLI backend her çağrıyı ayrı süreçte çalıştırır.
  // Not: documentationJob ekranları CONCURRENCY=3 ile işler; bu çarpan
  // sekme eşzamanlılığıyla çoğalır → varsayılan 3 makul (TAB_GEN_CONCURRENCY).
  const concurrency = Math.max(1, Number(process.env.TAB_GEN_CONCURRENCY) || 3);
  const total = tabs.length + 1;
  let doneCount = 0;
  const tick = (label: string) => onProgress?.(`Bölüm ${++doneCount}/${total} tamamlandı: ${label}`);
  console.log(`[userManual] ${tabs.length} sekme → ${total} bölüm, ${concurrency}'lü paralel üretim`);

  // Genel bakış (sekme-dışı state'ler) tab'larla EŞZAMANLI başlatılır.
  // overviewTabs: genel bakış "ortak mekanikleri bir kez anlat" görevini alır
  // (sekme bölümleri sayfalama/tablo mekaniği yazmak yerine buraya referans verir).
  const overviewCtx: ScreenContext = { ...ctx, screen: { ...ctx.screen, states: baseStates } };
  const overviewP = generateUserManualSection(overviewCtx, templates, { overviewTabs: tabs.map((t) => t.label), ...(liveAppEvidence ? { liveAppEvidence } : {}) })
    .then((r) => { tick("genel bakış"); return { ok: true as const, r }; })
    .catch((e: Error) => ({ ok: false as const, e }));

  // Sekme bölümleri: sınırlı eşzamanlılık, SIRA index ile korunur.
  const tabResults: (GenerationResult | null)[] = new Array(tabs.length).fill(null);
  // Kalıcı olarak (retry sonrası da) üretilemeyen sekmeler — bu doküman EKSİK
  // kalır; screenProcessor bunu doküman içine görünür bir uyarı olarak basar
  // (aksi halde sekme sessizce kaybolup 'başarılı' görünüyordu — gerçek olay).
  const failedTabs: string[] = [];
  let cursor = 0;
  // Abonelik/kullanım limiti hatası → YARIM doküman üretme; tüm üretimi
  // durdur ve fırlat (screenProcessor ekranı 'failed' yapar → kullanıcı
  // bilir + limit sıfırlanınca 'Eksikleri Üret' ile tam üretir).
  let limitError: Error | null = null;
  const runner = async () => {
    while (cursor < tabs.length) {
      if (limitError) return; // başka runner limit yakaladı → dur
      const i = cursor++;
      const tab = tabs[i] as (typeof tabs)[number];
      const attempt = async () => generateUserManualSection(ctx, templates, {
        statesOverride: tab.states,
        tabLabel: tab.label,
      });
      try {
        tabResults[i] = await attempt();
        console.log(`[userManual]   ✓ '${tab.label}' sekmesi üretildi (${tab.states.length} görsel)`);
      } catch (e) {
        if (isUsageLimitError(e)) {
          limitError = e as Error;
          cursor = tabs.length; // kalan sekmeleri deneme (hepsi limit'e takılır)
          console.warn(`[userManual]   ⛔ Kullanım limiti — üretim durduruldu: ${(e as Error).message}`);
          return;
        }
        // Geçici hata olabilir (örn. CLI zaman aşımı — kaynak çakışması).
        // Sessizce vazgeçmeden ÖNCE bir kez daha dene; sekmeyi kaybetmek
        // (kılavuzda hiç anlatılmaması) sessiz-tekrar-denemekten daha kötü.
        console.warn(`[userManual]   ✗ '${tab.label}' 1. deneme başarısız: ${(e as Error).message} — 2sn sonra tekrar denenecek`);
        await sleep(2000);
        try {
          tabResults[i] = await attempt();
          console.log(`[userManual]   ✓ '${tab.label}' sekmesi 2. denemede üretildi (${tab.states.length} görsel)`);
        } catch (e2) {
          if (isUsageLimitError(e2)) {
            limitError = e2 as Error;
            cursor = tabs.length;
            console.warn(`[userManual]   ⛔ Kullanım limiti (2. deneme) — üretim durduruldu: ${(e2 as Error).message}`);
            return;
          }
          console.error(`[userManual]   ✗ '${tab.label}' sekmesi 2 denemede de üretilemedi: ${(e2 as Error).message} — KILAVUZDA EKSİK KALACAK`);
          tabResults[i] = null;
          failedTabs.push(tab.label);
        }
      }
      tick(tab.label);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tabs.length) }, runner));

  // Genel bakış kritik — başarısızsa ekran hatası (sekme hatası tolere edilir).
  const overview = await overviewP;
  if (!overview.ok) throw overview.e;

  // Limit hatası oluştuysa YARIM doküman ÜRETME — temiz fırlat.
  if (limitError) throw limitError;

  // SIRALI birleştirme: genel bakış → tab0 → tab1 … (paralellik sırayı bozmaz).
  // Genel bakış + sekmeler AYRIK tutulur: coverage/fix-up yalnız genel bakışta
  // çalışacak (screenProcessor `overviewContent`/`tabsContent` kullanır).
  const tabSections = tabResults.filter((r): r is GenerationResult => r !== null);
  const overviewContent = overview.r.content;
  const tabsContent = tabSections.map((r) => r.content).join(SECTION_JOINER);

  // Token + truncated toplama (genel bakış + tüm sekmeler).
  let acc = overview.r;
  for (const r of tabSections) acc = mergeResults(acc, r, SECTION_JOINER);

  return {
    content: tabsContent ? overviewContent + SECTION_JOINER + tabsContent : overviewContent,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheReadTokens: acc.cacheReadTokens ?? 0,
    cacheCreationTokens: acc.cacheCreationTokens ?? 0,
    ...(acc.truncated ? { truncated: true } : {}),
    overviewContent,
    tabsContent,
    ...(failedTabs.length > 0 ? { failedTabs } : {}),
  };
}
