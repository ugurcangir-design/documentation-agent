import path from "path";

import { env } from "./config/env";

import { readSwaggerFiles } from "./ingestion/swaggerReader";
import { extractEndpoints } from "./ingestion/swaggerParser";
import { loadDocuments } from "./ingestion/documentLoader";

import { parseBrdSections } from "./retrieval/brdSectionParser";

import { BrowserSession } from "./browser/browserSession";
import { discoverScreens } from "./browser/screenDiscovery";

import { analyzeScreen } from "./analysis/screenAnalyzer";
import { buildScreenContext } from "./analysis/screenContextBuilder";

import { generateUserManualSection } from "./generator/userManualGenerator";
import { generateTechnicalDocSection } from "./generator/technicalDocGenerator";

import { publishToConfluence } from "./publisher/confluencePublisher";

import { writeOutputFile } from "./utils/fileWriter";

import { Endpoint } from "./types/endpoint";
import { DocumentSection } from "./types/documentSource";
import { ScreenDocumentation, DocumentationOutput } from "./types/documentation";

async function main(): Promise<void> {
  console.log("=== Documentation Agent ===\n");

  // ── 1. DOCUMENT INGESTION ───────────────────────────────────────────
  console.log("========== DOCUMENT INGESTION ==========");

  const swaggerFiles = readSwaggerFiles();
  const allEndpoints: Endpoint[] = [];

  console.log(`Swagger files: ${swaggerFiles.length}`);

  for (const swaggerFile of swaggerFiles) {
    const endpoints = extractEndpoints(
      swaggerFile.content,
      swaggerFile.fileName
    );

    allEndpoints.push(...endpoints);
    console.log(`  ${swaggerFile.fileName}: ${endpoints.length} endpoints`);
  }

  console.log(`Total endpoints: ${allEndpoints.length}`);

  const documentSources = loadDocuments({
    type: "brd",
    directory: "data/brd",
    extension: ".md",
  });

  const allSections: DocumentSection[] = [];

  for (const document of documentSources) {
    const sections = parseBrdSections(
      document.content,
      document.fileName
    );

    allSections.push(...sections);
    console.log(`  ${document.fileName}: ${sections.length} sections`);
  }

  console.log(`Total BRD sections: ${allSections.length}`);

  // ── 2. BROWSER SESSION ──────────────────────────────────────────────
  console.log("\n========== BROWSER SESSION ==========");

  const session = new BrowserSession();

  try {
    console.log("Launching browser...");
    await session.launch();

    console.log("Logging in...");
    await session.login();

    const page = session.getPage();

    // ── 3. SCREEN DISCOVERY ───────────────────────────────────────────
    console.log("\n========== SCREEN DISCOVERY ==========");

    const discoveredScreens = await discoverScreens(page);

    console.log(`\nDiscovered ${discoveredScreens.length} screens`);

    // ── 4. PER-SCREEN ANALYSIS & DOC GENERATION ───────────────────────
    console.log("\n========== SCREEN ANALYSIS & GENERATION ==========");

    const appTitle = await page.title().catch(() => "Uygulama");
    const screenDocs: ScreenDocumentation[] = [];

    for (const screen of discoveredScreens) {
      console.log(`\n  Processing: ${screen.path} — "${screen.title}"`);

      try {
        console.log(`    Analyzing screen...`);
        const analysis = await analyzeScreen(screen);
        console.log(`    Screen title: ${analysis.screenTitle}`);

        console.log(`    Building context...`);
        const context = buildScreenContext(
          screen,
          analysis,
          allSections,
          allEndpoints
        );

        console.log(
          `    Context: ${context.relatedSections.length} BRD sections, ${context.relatedEndpoints.length} endpoints`
        );

        console.log(`    Generating user manual section...`);
        const userManualSection = await generateUserManualSection(context);

        console.log(`    Generating technical doc section...`);
        const technicalDocSection = await generateTechnicalDocSection(context);

        screenDocs.push({
          screen,
          analysis,
          userManualSection,
          technicalDocSection,
        });

        console.log(`    Done.`);
      } catch (err) {
        console.error(
          `    Failed to process screen ${screen.path}: ${(err as Error).message}`
        );
      }
    }

    // ── 5. ASSEMBLE DOCUMENTS ─────────────────────────────────────────
    console.log("\n========== ASSEMBLING DOCUMENTS ==========");

    const userManual = assembleUserManual(appTitle, screenDocs);
    const technicalDoc = assembleTechnicalDoc(appTitle, screenDocs);

    const output: DocumentationOutput = {
      appTitle,
      userManual,
      technicalDoc,
      screens: screenDocs,
      generatedAt: new Date().toISOString(),
    };

    // ── 6. WRITE LOCAL OUTPUT ─────────────────────────────────────────
    console.log("\n========== LOCAL OUTPUT ==========");

    const userManualPath = writeOutputFile(
      "kullanici-kilavuzu.md",
      userManual
    );

    const technicalDocPath = writeOutputFile(
      "teknik-dokuman.md",
      technicalDoc
    );

    console.log(`User manual  → ${userManualPath}`);
    console.log(`Technical doc → ${technicalDocPath}`);

    // ── 7. CONFLUENCE PUBLISH ─────────────────────────────────────────
    console.log("\n========== CONFLUENCE PUBLISH ==========");

    await publishToConfluence(output);

    console.log("\n=== Documentation Agent Complete ===");
    console.log(`Screens processed: ${screenDocs.length}`);
    console.log(`User manual:   ${userManualPath}`);
    console.log(`Technical doc: ${technicalDocPath}`);
  } finally {
    await session.close();
  }
}

function assembleUserManual(
  appTitle: string,
  screenDocs: ScreenDocumentation[]
): string {
  const sections = screenDocs
    .map((d) => d.userManualSection)
    .filter(Boolean)
    .join("\n\n---\n\n");

  return [
    `# ${appTitle} — Kullanıcı Kılavuzu`,
    "",
    `> Bu döküman otomatik olarak oluşturulmuştur. Tarih: ${new Date().toLocaleDateString("tr-TR")}`,
    "",
    "## İçindekiler",
    "",
    ...screenDocs.map(
      (d, i) =>
        `${i + 1}. [${d.analysis.screenTitle}](#${slugify(d.analysis.screenTitle)})`
    ),
    "",
    "---",
    "",
    sections,
  ].join("\n");
}

function assembleTechnicalDoc(
  appTitle: string,
  screenDocs: ScreenDocumentation[]
): string {
  const sections = screenDocs
    .map((d) => d.technicalDocSection)
    .filter(Boolean)
    .join("\n\n---\n\n");

  return [
    `# ${appTitle} — Teknik Döküman`,
    "",
    `> Bu döküman otomatik olarak oluşturulmuştur. Tarih: ${new Date().toLocaleDateString("tr-TR")}`,
    "",
    "## İçindekiler",
    "",
    ...screenDocs.map(
      (d, i) =>
        `${i + 1}. [${d.analysis.screenTitle}](#${slugify(d.analysis.screenTitle)})`
    ),
    "",
    "---",
    "",
    sections,
  ].join("\n");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[çÇ]/g, "c")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[ıİ]/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
