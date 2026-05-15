import { v4 as uuid } from "uuid";

import { readSwaggerFiles } from "../../ingestion/swaggerReader";
import { extractEndpoints } from "../../ingestion/swaggerParser";
import { loadDocuments } from "../../ingestion/documentLoader";
import { readConfluencePages } from "../../ingestion/confluenceReader";
import { parseBrdSections } from "../../retrieval/brdSectionParser";

import { analyzeScreen } from "../../analysis/screenAnalyzer";
import { buildScreenContext } from "../../analysis/screenContextBuilder";
import { generateUserManualSection } from "../../generator/userManualGenerator";
import { generateTechnicalDocSection } from "../../generator/technicalDocGenerator";

import { screenStore } from "../store/screenStore";
import { documentStore } from "../store/documentStore";
import { jobStore } from "../store/jobStore";
import { emitJobEvent } from "../store/eventBus";

import type { Endpoint } from "../../types/endpoint";
import type { DocumentSection } from "../../types/documentSource";

export async function runDocumentationJob(
  jobId: string,
  selectedScreenPaths: string[]
): Promise<void> {
  const total = selectedScreenPaths.length;

  jobStore.update(jobId, {
    status: "running",
    progress: { current: 0, total, message: "Dökümanlar yükleniyor..." },
  });

  emitJobEvent(jobId, {
    type: "progress",
    message: "Swagger ve BRD dökümanları yükleniyor...",
    current: 0,
    total,
  });

  // ── Load all context sources ─────────────────────────────────────
  const allEndpoints: Endpoint[] = [];
  const swaggerFiles = readSwaggerFiles();

  for (const sf of swaggerFiles) {
    allEndpoints.push(...extractEndpoints(sf.content, sf.fileName));
  }

  const allSections: DocumentSection[] = [];

  const brdDocs = loadDocuments({
    type: "brd",
    directory: "data/brd",
    extension: ".md",
  });

  for (const doc of brdDocs) {
    allSections.push(...parseBrdSections(doc.content, doc.fileName));
  }

  // Confluence pages as additional context (Goal 2)
  emitJobEvent(jobId, {
    type: "progress",
    message: "Confluence dökümanları çekiliyor...",
    current: 0,
    total,
  });

  const confluenceSections = await readConfluencePages();
  allSections.push(...confluenceSections);

  emitJobEvent(jobId, {
    type: "progress",
    message: `Context hazır: ${allEndpoints.length} endpoint, ${allSections.length} döküman bölümü`,
    current: 0,
    total,
  });

  // ── Process each selected screen ────────────────────────────────
  for (let i = 0; i < selectedScreenPaths.length; i++) {
    const screenPath = selectedScreenPaths[i];

    if (!screenPath) continue;

    const storedScreen = screenStore.getByPath(screenPath);

    if (!storedScreen) {
      emitJobEvent(jobId, {
        type: "error",
        message: `Ekran bulunamadı: ${screenPath}`,
        current: i + 1,
        total,
      });
      continue;
    }

    const screenTitle = storedScreen.title || screenPath;

    emitJobEvent(jobId, {
      type: "progress",
      message: `Analiz ediliyor: ${screenTitle}`,
      current: i + 1,
      total,
    });

    jobStore.update(jobId, {
      progress: {
        current: i + 1,
        total,
        message: `Analiz ediliyor: ${screenTitle}`,
      },
    });

    try {
      const screen = screenStore.toDiscoveredScreen(storedScreen);

      const analysis = await analyzeScreen(screen);

      emitJobEvent(jobId, {
        type: "progress",
        message: `Bağlam oluşturuluyor: ${screenTitle}`,
        current: i + 1,
        total,
      });

      const context = buildScreenContext(
        screen,
        analysis,
        allSections,
        allEndpoints
      );

      emitJobEvent(jobId, {
        type: "progress",
        message: `Kullanıcı kılavuzu yazılıyor: ${screenTitle}`,
        current: i + 1,
        total,
      });

      const userManualContent = await generateUserManualSection(context);

      emitJobEvent(jobId, {
        type: "progress",
        message: `Teknik döküman yazılıyor: ${screenTitle}`,
        current: i + 1,
        total,
      });

      const technicalDocContent =
        await generateTechnicalDocSection(context);

      documentStore.create({
        id: uuid(),
        jobId,
        screenPath,
        screenTitle: analysis.screenTitle || screenTitle,
        screenshotPath: storedScreen.screenshotPath,
        userManualContent,
        technicalDocContent,
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      emitJobEvent(jobId, {
        type: "screen",
        message: `Tamamlandı: ${screenTitle}`,
        current: i + 1,
        total,
        data: { screenPath, screenTitle },
      });
    } catch (err) {
      emitJobEvent(jobId, {
        type: "error",
        message: `Hata (${screenTitle}): ${(err as Error).message}`,
        current: i + 1,
        total,
      });
    }
  }

  jobStore.update(jobId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    progress: {
      current: total,
      total,
      message: "Tüm dökümanlar oluşturuldu",
    },
  });

  emitJobEvent(jobId, {
    type: "complete",
    message: "Tüm dökümanlar oluşturuldu",
    current: total,
    total,
  });
}
