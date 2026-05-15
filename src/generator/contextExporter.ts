import { FeatureContext } from "../types/featureContext";
import { removeDuplicateParagraphs } from "../quality/duplicateRemover";
import { buildEvidenceMap } from "./evidenceMapper";

export function exportFeatureContextForAi(
  context: FeatureContext
) {
  return {
    featureName: context.featureName,
    generatedAt: context.generatedAt,
    conflicts: context.detectedConflicts,
    evidenceMap: buildEvidenceMap(context),

    brdSections: context.relatedSections.slice(0, 8).map((item) => ({
      score: item.score,
      title: item.section.title,
      source: {
        file: item.section.sourceFile,
        section: item.section.title,
      },
      content: removeDuplicateParagraphs(
        item.section.content
      ).substring(0, 1500),
    })),

endpoints: context.relatedEndpoints.slice(0, 15).map((item) => ({
  score: item.score,
  source: {
    swagger: item.endpoint.sourceSwagger,
    service: item.endpoint.serviceName,
  },
  service: item.endpoint.serviceName,
  method: item.endpoint.method,
  path: item.endpoint.path,
  summary: item.endpoint.summary,
  tags: item.endpoint.tags,
  operationId: item.endpoint.operationId,
})),

    documentationRules: {
      language: "Turkish",
      style: "Kurumsal, açık, insan tarafından yazılmış gibi",
      doNotInventMissingInformation: true,
      markUncertainInformation: true,
      includeOpenQuestions: true,
      produceUserGuide: true,
      produceTechnicalGuide: true,
      requireSourceTraceability: true,
    },
  };
}