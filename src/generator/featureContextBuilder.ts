import { Endpoint } from "../types/endpoint";
import { FeatureContext } from "../types/featureContext";
import { DocumentSection } from "../types/documentSource";

import {
  searchDocumentSections,
  RankedDocumentSection,
} from "../retrieval/documentSearch";

import { searchEndpoints } from "../retrieval/endpointSearch";

import { detectConflicts } from "../quality/conflictDetector";

export function buildFeatureContext(
  featureName: string,
  sections: DocumentSection[],
  endpoints: Endpoint[]
): FeatureContext {
  const relatedSections: RankedDocumentSection[] =
    searchDocumentSections(
      sections,
      featureName
    );

  const relatedEndpoints = searchEndpoints(
    endpoints,
    featureName
  );

  const detectedConflicts =
    detectConflicts(relatedSections);

  return {
    featureName,

    relatedSections,

    relatedEndpoints,

    detectedConflicts,

    generatedAt: new Date().toISOString(),
  };
}