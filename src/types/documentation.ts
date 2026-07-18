import { DiscoveredScreen, ScreenAnalysis } from "./screen";
import { RankedDocumentSection } from "../retrieval/documentSearch";
import { RankedEndpoint } from "../retrieval/endpointSearch";
import { PreparedChunk } from "../retrieval/contextBudget";
import { MatchedParagraph } from "../retrieval/paragraphSearch";

export interface ScreenContext {
  screen: DiscoveredScreen;
  analysis: ScreenAnalysis;
  relatedSections: RankedDocumentSection[];
  relatedEndpoints: RankedEndpoint[];
  preparedChunks: PreparedChunk[];
  /** Long-tail keyword matches: paragraphs anywhere in the corpus that
   *  mention multiple query terms but are inside otherwise-low-ranked
   *  sections. Captures detail the section-level retrieval misses. */
  paragraphMatches: MatchedParagraph[];
}

export interface ScreenDocumentation {
  screen: DiscoveredScreen;
  analysis: ScreenAnalysis;
  userManualSection: string;
}

export interface DocumentationOutput {
  appTitle: string;
  userManual: string;
  screens: ScreenDocumentation[];
  generatedAt: string;
}
