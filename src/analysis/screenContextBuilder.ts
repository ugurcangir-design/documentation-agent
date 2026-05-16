import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { ScreenContext } from "../types/documentation";
import { DocumentSection } from "../types/documentSource";
import { Endpoint } from "../types/endpoint";
import { searchDocumentSections } from "../retrieval/documentSearch";
import { searchEndpoints } from "../retrieval/endpointSearch";
import { searchParagraphs } from "../retrieval/paragraphSearch";
import { prepareDocumentChunks } from "../retrieval/contextBudget";

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

  const relatedSections = searchDocumentSections(allSections, keywords).slice(0, 20);
  const relatedEndpoints = searchEndpoints(allEndpoints, keywords).slice(0, 30);

  // Section-level chunks (diversity + 18KB budget)
  const preparedChunks = prepareDocumentChunks(relatedSections, 18_000, 2500);

  // Paragraph-level matches — captures relevant detail buried in
  // low-ranked sections. Limited so we don't blow the prompt.
  const usedSectionTitles = new Set(preparedChunks.map((c) => c.title));
  const paragraphMatches = searchParagraphs(allSections, keywords, {
    minHits: 2,
    maxPerSection: 2,
    maxTotal: 12,
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
