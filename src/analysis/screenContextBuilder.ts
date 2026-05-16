import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { ScreenContext } from "../types/documentation";
import { DocumentSection } from "../types/documentSource";
import { Endpoint } from "../types/endpoint";
import { searchDocumentSections } from "../retrieval/documentSearch";
import { searchEndpoints } from "../retrieval/endpointSearch";
import { prepareDocumentChunks } from "../retrieval/contextBudget";

export function buildScreenContext(
  screen: DiscoveredScreen,
  analysis: ScreenAnalysis,
  allSections: DocumentSection[],
  allEndpoints: Endpoint[]
): ScreenContext {
  // Build a focused query: screen title carries the most signal,
  // followed by UI element labels (which are concrete domain terms),
  // then workflow names, then purpose prose.
  const queryParts = [
    analysis.screenTitle,
    analysis.screenTitle, // double weight for title
    ...analysis.uiElements.slice(0, 20).map((el) => el.label),
    ...analysis.workflows.map((wf) => wf.name),
    ...analysis.dataDisplayed,
    analysis.purpose,
  ].filter(Boolean);

  const keywords = queryParts.join(" ");

  // Retrieve more candidates than we'll keep — diversity reranking will
  // trim duplicates and the budget will trim length.
  const relatedSections = searchDocumentSections(allSections, keywords).slice(0, 20);
  const relatedEndpoints = searchEndpoints(allEndpoints, keywords).slice(0, 30);

  // Apply chunking + diversity + 18KB budget
  const preparedChunks = prepareDocumentChunks(relatedSections, 18_000, 2500);

  return {
    screen,
    analysis,
    relatedSections,
    relatedEndpoints: relatedEndpoints.slice(0, 12),
    preparedChunks,
  };
}
