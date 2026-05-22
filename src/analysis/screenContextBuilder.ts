import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { ScreenContext } from "../types/documentation";
import { DocumentSection } from "../types/documentSource";
import { Endpoint } from "../types/endpoint";
import { searchDocumentSections, type RankedDocumentSection } from "../retrieval/documentSearch";
import { searchEndpoints } from "../retrieval/endpointSearch";
import { searchParagraphs } from "../retrieval/paragraphSearch";
import { prepareDocumentChunks } from "../retrieval/contextBudget";

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
function balanceBySourceType(ranked: RankedDocumentSection[]): RankedDocumentSection[] {
  const GUARANTEED_PER_TYPE = 2;

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

  // Round 1 — top-N of each type, so each reference kind is guaranteed
  // a seat at the table.
  for (let i = 0; i < GUARANTEED_PER_TYPE; i++) {
    for (const list of byType.values()) {
      const item = list[i];
      if (item && !seen.has(item)) {
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

  // Rank every relevant section (score > 0), then balance the ordering
  // so BRD, Confluence, Jira and uploaded-doc references all surface.
  const rankedSections = searchDocumentSections(allSections, keywords);
  const balancedSections = balanceBySourceType(rankedSections);
  const relatedSections = balancedSections.slice(0, 20);
  const relatedEndpoints = searchEndpoints(allEndpoints, keywords).slice(0, 30);

  // Section-level chunks — 16KB total budget, 2.2KB per chunk. Fed from
  // the balanced list so a guaranteed slot of each source type lands in
  // the prompt. Generators fall back to a smaller prompt if Claude
  // rejects with 'prompt too long', so we don't pre-emptively cut here.
  const preparedChunks = prepareDocumentChunks(balancedSections, 16_000, 2200);

  // Paragraph-level matches — 9 paragraphs from any section, captures
  // long-tail BRD detail buried in low-ranked sections.
  const usedSectionTitles = new Set(preparedChunks.map((c) => c.title));
  const paragraphMatches = searchParagraphs(allSections, keywords, {
    minHits: 2,
    maxPerSection: 2,
    maxTotal: 9,
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
