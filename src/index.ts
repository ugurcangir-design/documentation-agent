import path from "path";

import { env } from "./config/env";

import { readSwaggerFiles } from "./ingestion/swaggerReader";
import { extractEndpoints } from "./ingestion/swaggerParser";
import { loadDocuments } from "./ingestion/documentLoader";

import { Endpoint } from "./types/endpoint";
import { DocumentSection } from "./types/documentSource";

import { parseBrdSections } from "./retrieval/brdSectionParser";

import { buildFeatureContext } from "./generator/featureContextBuilder";
import { generateTechnicalMarkdown } from "./generator/markdownGenerator";
import { exportFeatureContextForAi } from "./generator/contextExporter";
import { refineDocumentInChunks } from "./generator/chunkedClaudeRefiner";

import { writeOutputFile } from "./utils/fileWriter";

console.log("Documentation Agent Started");

console.log({
  confluenceConfigured: !!env.confluenceBaseUrl,
  appConfigured: !!env.appBaseUrl,
});

const featureName = "Market Risk";

console.log(`\nTarget Feature: ${featureName}`);

console.log("\n========== SWAGGER INGESTION ==========");

const swaggerFiles = readSwaggerFiles();

const allEndpoints: Endpoint[] = [];

console.log(`Swagger files found: ${swaggerFiles.length}`);

for (const swaggerFile of swaggerFiles) {
  const endpoints = extractEndpoints(
    swaggerFile.content,
    swaggerFile.fileName
  );

  allEndpoints.push(...endpoints);

  console.log({
    swagger: swaggerFile.fileName,
    endpoints: endpoints.length,
  });
}

console.log(`Total endpoints indexed: ${allEndpoints.length}`);

console.log("\n========== DOCUMENT INGESTION ==========");

const documentSources = loadDocuments({
  type: "brd",
  directory: "data/brd",
  extension: ".md",
});

const allSections: DocumentSection[] = [];

console.log(`Document sources found: ${documentSources.length}`);

for (const document of documentSources) {
  const sections = parseBrdSections(
    document.content,
    document.fileName
  );

  allSections.push(...sections);

  console.log({
    sourceType: document.type,
    sourceFile: document.fileName,
    sections: sections.length,
  });
}

console.log(`Total document sections indexed: ${allSections.length}`);

console.log("\n========== FEATURE CONTEXT ==========");

const featureContext = buildFeatureContext(
  featureName,
  allSections,
  allEndpoints
);

console.log({
  featureName: featureContext.featureName,
  relatedSections: featureContext.relatedSections.length,
  relatedEndpoints: featureContext.relatedEndpoints.length,
  generatedAt: featureContext.generatedAt,
});

console.log("\n========== RAW DOCUMENT GENERATION ==========");

const markdown = generateTechnicalMarkdown(featureContext);

const rawDocPath = writeOutputFile(
  "market-risk-technical-doc.md",
  markdown
);

console.log({
  generated: true,
  output: rawDocPath,
});

console.log("\n========== AI CONTEXT EXPORT ==========");

const aiContext = exportFeatureContextForAi(featureContext);

const aiContextPath = writeOutputFile(
  "market-risk-ai-context.json",
  JSON.stringify(aiContext, null, 2)
);

console.log({
  aiContextGenerated: true,
  output: aiContextPath,
});

console.log("\n========== CLAUDE REFINEMENT ==========");

const refinedOutputPath =
  refineDocumentInChunks(
    aiContextPath,
    "market-risk-technical-doc-refined.md"
  );

console.log({
  refined: true,
  output: refinedOutputPath,
});