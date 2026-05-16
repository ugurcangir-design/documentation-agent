import { DiscoveredScreen, ScreenAnalysis } from "./screen";
import { RankedDocumentSection } from "../retrieval/documentSearch";
import { RankedEndpoint } from "../retrieval/endpointSearch";
import { PreparedChunk } from "../retrieval/contextBudget";

export interface ScreenContext {
  screen: DiscoveredScreen;
  analysis: ScreenAnalysis;
  relatedSections: RankedDocumentSection[];
  relatedEndpoints: RankedEndpoint[];
  /** Diversity-aware, budget-capped chunks the generator should inject */
  preparedChunks: PreparedChunk[];
}

export interface ScreenDocumentation {
  screen: DiscoveredScreen;
  analysis: ScreenAnalysis;
  userManualSection: string;
  technicalDocSection: string;
}

export interface DocumentationOutput {
  appTitle: string;
  userManual: string;
  technicalDoc: string;
  screens: ScreenDocumentation[];
  generatedAt: string;
}
