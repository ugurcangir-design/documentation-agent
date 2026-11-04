import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { ScreenContext } from "../types/documentation";
import { DocumentSection } from "../types/documentSource";
import { Endpoint } from "../types/endpoint";
import { searchDocumentSections, type RankedDocumentSection } from "../retrieval/documentSearch";
import { searchEndpoints } from "../retrieval/endpointSearch";
import { searchParagraphs } from "../retrieval/paragraphSearch";
import { getChunkIndex, retrieveChunks } from "../retrieval/hybridRetrieval";
import { tokenize } from "../quality/confidenceScorer";
import { extractReferenceRules } from "../retrieval/ruleExtractor";
import { crossCheckBehaviors } from "../quality/behaviorCrossCheck";
import { env } from "../config/env";

/**
 * Re-order ranked sections so every source type that has a relevant
 * match is represented near the front of the list.
 *
 * Without this, a high-scoring source (BRD is weighted 1.0, Jira only
 * 0.75) can fill the entire context budget and Jira tickets, Confluence
 * pages or uploaded documents never reach the prompt — even when they
 * are genuinely relevant. The pure score order is still honoured for
 * everything past the guaranteed slots, and irrelevant sections (score
 * 0) were already dropped by `searchDocumentSections`.
 */
export function balanceBySourceType(ranked: RankedDocumentSection[]): RankedDocumentSection[] {
  const GUARANTEED_PER_TYPE = 2;
  // Garanti koltuğu YALNIZ anlamlı skorlu bölümlere verilir. Eski davranış:
  // bir tipin en iyi 2'si KOŞULSUZ öne alınıyordu → tek gevşek token isabetiyle
  // score≈1 alan, bu ekranla ALAKASIZ bir Jira/Confluence bölümü de garanti
  // koltuğa girip yanlış bilgi besleyebiliyordu. Eşik: en yüksek skorun %20'si
  // (adaptif) — gerçekten ilgili çok-tipli eşleşmeler bunun çok üstündedir.
  const topScore = ranked[0]?.score ?? 0;
  const guaranteedThreshold = topScore * 0.2;

  const byType = new Map<string, RankedDocumentSection[]>();
  for (const r of ranked) {
    const list = byType.get(r.section.sourceType);
    if (list) list.push(r);
    else byType.set(r.section.sourceType, [r]);
  }
  // Single type → nothing to balance.
  if (byType.size <= 1) return ranked;

  const out: RankedDocumentSection[] = [];
  const seen = new Set<RankedDocumentSection>();

  // Round 1 — her tipin en iyi N'i, ANCAK eşik üstündeyse (alakasızı zorlama).
  for (let i = 0; i < GUARANTEED_PER_TYPE; i++) {
    for (const list of byType.values()) {
      const item = list[i];
      if (item && !seen.has(item) && item.score >= guaranteedThreshold) {
        out.push(item);
        seen.add(item);
      }
    }
  }
  // Round 2 — everything else, in global score order.
  for (const r of ranked) {
    if (!seen.has(r)) {
      out.push(r);
      seen.add(r);
    }
  }
  return out;
}

export function buildScreenContext(
  screen: DiscoveredScreen,
  analysis: ScreenAnalysis,
  allSections: DocumentSection[],
  allEndpoints: Endpoint[]
): ScreenContext {
  // Title is the strongest signal — give it double weight
  // Faz 3: keşifte türetilen davranış kuralları (ör. "Ticket ID doluyken …")
  // sorguya eklenir → ilgili kural bölümleri (Jira/BRD) daha isabetli gelir;
  // istek parametre adları (ticketId → ticket id) da anahtar kelime olur.
  // Genel API sözlüğü (sortBy/page/size…) sorguya GİRMEZ: her liste ekranında
  // geçtiği için alakasız modüllerin sıralama/sayfalama kayıtlarını çekiyordu.
  const GENERIC_PARAMS = new Set(["sortby", "sortdirection", "page", "size", "sort", "direction", "offset", "limit"]);
  const behaviorTerms = (screen.behaviors ?? []).flatMap((b) => [
    b.statement,
    ...(b.evidence.requests ?? []).flatMap((r) => Object.keys(r.query)
      .filter((k) => !GENERIC_PARAMS.has(k.toLowerCase()))
      .map((k) => k.replace(/([a-z])([A-Z])/g, "$1 $2"))),
  ]);
  // Ekranın BİRİNCİL varlığı: başlık + path token'ları. Sorguda 3× (BM25 qtf
  // boost) ve retrieval'da entity gate olarak kullanılır.
  const pathTokens = screen.path.split(/[/\-_.]+/).filter((s) => s.length > 2);
  const entityTokens = [...new Set([...tokenize(analysis.screenTitle), ...pathTokens.map((t) => t.toLowerCase())])];
  const queryParts = [
    analysis.screenTitle, analysis.screenTitle, analysis.screenTitle,
    ...pathTokens,
    ...analysis.uiElements.slice(0, 25).map((el) => el.label),
    ...analysis.workflows.map((wf) => wf.name),
    ...analysis.dataDisplayed,
    analysis.purpose,
    ...behaviorTerms,
  ].filter(Boolean);

  const keywords = queryParts.join(" ");

  // ENDPOINT sorgusu AYRI ve DAHA ODAKLI: yukarıdaki `keywords` ekranın TÜM
  // kolon etiketlerini içerir (ör. "Retailer ID/Location") → tek başına "retailer"
  // token'ı, ekranın gerçek varlığıyla (ticket) ALAKASIZ endpoint'leri
  // (risk-service/retailers) öne çıkarıyordu. Endpoint eşleşmesi için ekranın
  // BİRİNCİL varlığını (başlık + URL path segmentleri, ör. ticket-explorer →
  // "ticket","explorer") ağırlıklandır; kolon etiketleri gürültüsünü ele.
  const endpointQuery = [
    analysis.screenTitle, analysis.screenTitle, analysis.screenTitle,
    ...pathTokens, ...pathTokens,
    ...analysis.workflows.map((wf) => wf.name),
    analysis.purpose,
  ].filter(Boolean).join(" ");

  const relatedEndpoints = searchEndpoints(allEndpoints, endpointQuery).slice(0, 30);

  // Hibrit retrieval (Analyst Studio tasarımı): 1200/200 parçalar, tek BM25
  // indeksi, entity gate, tür başına kota + global bütçe (env.contextDocBudget).
  // Eski yol (ham kelime sayımı + bölümün ilk 2.6KB'si) doğrudan ilgili
  // Confluence sayfalarını kaçırıp alakasız Jira kayıtlarını dolduruyordu.
  const index = getChunkIndex(allSections);
  const preparedChunks = retrieveChunks(index, keywords, {
    budget: env.contextDocBudget,
    typeCaps: env.contextTypeCaps,
    entityTokens,
    titlePhrase: analysis.screenTitle,
  });
  // relatedSections: prompt'a giren kaynakların bölümleri (trace + kural
  // çıkarımı). Eski keyword sıralaması yalnız yedek olarak (hiç parça yoksa).
  const sectionById = new Map(allSections.map((s) => [s.id, s] as const));
  const relatedSections: RankedDocumentSection[] = preparedChunks
    .map((c) => ({ score: c.score, section: (c.sectionId ? sectionById.get(c.sectionId) : undefined)! }))
    .filter((r) => !!r.section);
  if (relatedSections.length === 0) {
    relatedSections.push(...balanceBySourceType(searchDocumentSections(allSections, keywords)).slice(0, 24));
  }

  // Paragraph-level matches — env.contextParagraphs (varsayılan 14) paragraf,
  // düşük-sıralı bölümlerde gömülü uzun-kuyruk BRD detayını yakalar.
  const usedSectionTitles = new Set(preparedChunks.map((c) => c.title));
  // Entity gate: paragraf, ekranın varlığını (başlık/path token'ı) içermeli —
  // eskiden başka ürünün kılavuz paragrafları doluyordu.
  const entityRe = entityTokens.length > 0
    ? new RegExp(entityTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i")
    : null;
  const paragraphMatches = searchParagraphs(allSections, keywords, {
    minHits: 2,
    maxPerSection: 2,
    maxTotal: env.contextParagraphs,
  }).filter((m) => !usedSectionTitles.has(m.sectionTitle))
    .filter((m) => !entityRe || entityRe.test(m.paragraph) || entityRe.test(m.sectionTitle));

  // Faz 3: referans kural çıkarımı (yalnız bu ekranın RAG'le seçilmiş
  // bölümlerinden — 2600+ bölümün tamamı değil) + gözlemle çapraz doğrulama.
  // Gözlem yoksa bile ekranla ilgili referans kuralları 'reference' kaynaklı
  // (koşullu anlatılacak) olarak döner.
  const observed = screen.behaviors ?? [];
  // Paragraf eşleşmeleri yalnız başlık/dosya taşır → tür/id'yi kaynağından al.
  const byTitle = new Map(allSections.map((sec) => [sec.title, sec] as const));
  // Kural kaynakları da entity-gated: prompt'a giren (ilgili) bölümler +
  // gated paragraflar. Alakasız Jira kaydı artık "referans" olarak iliştirilmez.
  const ruleSections: DocumentSection[] = [
    ...relatedSections.map((r) => r.section),
    ...paragraphMatches.map((m) => {
      const src = byTitle.get(m.sectionTitle);
      return {
        id: `${m.sectionTitle}#p`, sourceId: src?.sourceId ?? "", sourceType: src?.sourceType ?? "manual",
        sourceFile: m.sourceFile, title: m.sectionTitle, content: m.paragraph,
      };
    }),
  ];
  const refRules = extractReferenceRules(ruleSections);
  const screenVocab = [analysis.screenTitle, ...analysis.uiElements.slice(0, 25).map((el) => el.label), analysis.purpose].join(" ");
  const behaviors = (observed.length > 0 || refRules.length > 0)
    ? crossCheckBehaviors(observed, refRules, screenVocab)
    : [];

  return {
    screen,
    analysis,
    relatedSections,
    relatedEndpoints: relatedEndpoints.slice(0, 12),
    preparedChunks,
    paragraphMatches,
    ...(behaviors.length > 0 ? { behaviors } : {}),
  };
}
