import { FeatureContext } from "../types/featureContext";

export function buildEvidenceMap(context: FeatureContext) {
  return {
    brdEvidence: context.relatedSections.slice(0, 8).map((item, index) => ({
      evidenceId: `BRD-${index + 1}`,
      score: item.score,
      sourceFile: item.section.sourceFile,
      sectionTitle: item.section.title,
      excerpt: item.section.content.substring(0, 500),
    })),

    endpointEvidence: context.relatedEndpoints.slice(0, 15).map((item, index) => ({
      evidenceId: `API-${index + 1}`,
      score: item.score,
      sourceSwagger: item.endpoint.sourceSwagger,
      serviceName: item.endpoint.serviceName,
      method: item.endpoint.method,
      path: item.endpoint.path,
      summary: item.endpoint.summary,
      operationId: item.endpoint.operationId,
    })),
  };
}