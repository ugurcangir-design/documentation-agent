import type { BehaviorFact } from "./behavior";
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
  /** Faz 3: keşifte gözlemlenen + referanslarla çapraz doğrulanan davranış
   *  kuralları (kaynak/güvenilirlik etiketli). Generator + trace kullanır. */
  behaviors?: BehaviorFact[];
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
