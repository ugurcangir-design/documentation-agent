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

  const relatedSections = searchDocumentSections(allSections, keywords).slice(0, 15);
  const relatedEndpoints = searchEndpoints(allEndpoints, keywords).slice(0, 20);

  // Section-level chunks — tighter budget (12KB) to stay safely
  // under Claude's prompt-too-long threshold with images attached.
  const preparedChunks = prepareDocumentChunks(relatedSections, 12_000, 1800);

  // Paragraph-level matches — fewer + shorter to keep prompt small.
  const usedSectionTitles = new Set(preparedChunks.map((c) => c.title));
  const paragraphMatches = searchParagraphs(allSections, keywords, {
    minHits: 2,
    maxPerSection: 1,
    maxTotal: 6,
  }).filter((m) => !usedSectionTitles.has(m.sectionTitle));

  return {
    screen,
    analysis,
    relatedSections,
    relatedEndpoints: relatedEndpoints.slice(0, 8),
    preparedChunks,
    paragraphMatches,
  };
}
