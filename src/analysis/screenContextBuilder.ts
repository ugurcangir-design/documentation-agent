import { DiscoveredScreen, ScreenAnalysis } from "../types/screen";
import { ScreenContext } from "../types/documentation";
import { DocumentSection } from "../types/documentSource";
import { Endpoint } from "../types/endpoint";
import { searchDocumentSections } from "../retrieval/documentSearch";
import { searchEndpoints } from "../retrieval/endpointSearch";

export function buildScreenContext(
  screen: DiscoveredScreen,
  analysis: ScreenAnalysis,
  allSections: DocumentSection[],
  allEndpoints: Endpoint[]
): ScreenContext {
  const keywords = [
    analysis.screenTitle,
    analysis.purpose,
    ...analysis.dataDisplayed,
    ...analysis.uiElements.map((el) => el.label),
    ...analysis.workflows.map((wf) => wf.name),
  ]
    .filter(Boolean)
    .join(" ");

  const relatedSections = searchDocumentSections(
    allSections,
    keywords
  ).slice(0, 6);

  const relatedEndpoints = searchEndpoints(
    allEndpoints,
    keywords
  ).slice(0, 10);

  return {
    screen,
    analysis,
    relatedSections,
    relatedEndpoints,
  };
}
