import { Endpoint } from "./endpoint";

import { RankedDocumentSection } from "../retrieval/documentSearch";

import { DetectedConflict } from "../quality/conflictDetector";

export interface RankedEndpoint {
  score: number;
  endpoint: Endpoint;
}

export interface FeatureContext {
  featureName: string;

  relatedSections: RankedDocumentSection[];

  relatedEndpoints: RankedEndpoint[];

  detectedConflicts: DetectedConflict[];

  generatedAt: string;
}