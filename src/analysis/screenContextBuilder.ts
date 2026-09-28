import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { ScreenContext } from "../types/documentation";
import { DocumentSection } from "../types/documentSource";
import { Endpoint } from "../types/endpoint";
import { searchDocumentSections, type RankedDocumentSection } from "../retrieval/documentSearch";
import { searchEndpoints } from "../retrieval/endpointSearch";
import { searchParagraphs } from "../retrieval/paragraphSearch";
import { prepareDocumentChunks } from "../retrieval/contextBudget";
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
  const queryParts = [
    analysis.screenTitle,
    analysis.screenTitle,
    ...analysis.uiElements.slice(0, 25).map((el) => el.label),
    ...analysis.workflows.map((wf) => wf.name),
    ...analysis.dataDisplayed,
    analysis.purpose,
  ].filter(Boolean);

  const keywords = queryParts.join(" ");

  // ENDPOINT sorgusu AYRI ve DAHA ODAKLI: yukarıdaki `keywords` ekranın TÜM
  // kolon etiketlerini içerir (ör. "Retailer ID/Location") → tek başına "retailer"
  // token'ı, ekranın gerçek varlığıyla (ticket) ALAKASIZ endpoint'leri
  // (risk-service/retailers) öne çıkarıyordu. Endpoint eşleşmesi için ekranın
  // BİRİNCİL varlığını (başlık + URL path segmentleri, ör. ticket-explorer →
  // "ticket","explorer") ağırlıklandır; kolon etiketleri gürültüsünü ele.
  const pathTokens = screen.path.split(/[/\-_.]+/).filter((s) => s.length > 2);
  const endpointQuery = [
    analysis.screenTitle, analysis.screenTitle, analysis.screenTitle,
    ...pathTokens, ...pathTokens,
    ...analysis.workflows.map((wf) => wf.name),
    analysis.purpose,
  ].filter(Boolean).join(" ");

  // Rank every relevant section (score > 0), then balance the ordering
  // so BRD, Confluence, Jira and uploaded-doc references all surface.
  const rankedSections = searchDocumentSections(allSections, keywords);
  const balancedSections = balanceBySourceType(rankedSections);
  const relatedSections = balancedSections.slice(0, 24);
  const relatedEndpoints = searchEndpoints(allEndpoints, endpointQuery).slice(0, 30);

  // Section-level chunks — bütçe env.contextDocBudget (varsayılan ~28KB) ile,
  // ~2.6KB/chunk. Balanced listeden beslenir → her kaynak tipinden ilgili
  // bölüm prompt'a girer. Bütçe artırıldı: eskiden 16KB'de ~7 bölümde kesiliyor,
  // ilgili Ticket Detail/History/Ön-Çalışma gibi kaynaklar prompt'a giremiyordu.
  // Generator 'prompt too long' alırsa küçük prompt'a düşer, o yüzden burada
  // ön-kesme yapmıyoruz.
  const preparedChunks = prepareDocumentChunks(balancedSections, env.contextDocBudget, 2600);

  // Paragraph-level matches — env.contextParagraphs (varsayılan 14) paragraf,
  // düşük-sıralı bölümlerde gömülü uzun-kuyruk BRD detayını yakalar.
  const usedSectionTitles = new Set(preparedChunks.map((c) => c.title));
  const paragraphMatches = searchParagraphs(allSections, keywords, {
    minHits: 2,
    maxPerSection: 2,
    maxTotal: env.contextParagraphs,
  }).filter((m) => !usedSectionTitles.has(m.sectionTitle));

  return {
    screen,
    analysis,
    relatedSections,
    relatedEndpoints: relatedEndpoints.slice(0, 12),
    preparedChunks,
    paragraphMatches,
  };
}
