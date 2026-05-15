import { v4 as uuid } from "uuid";
import fs from "fs";

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
import { referenceStore } from "../store/referenceStore";
import { emitJobEvent } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";

import type { Endpoint } from "../../types/endpoint";
import type { DocumentSection } from "../../types/documentSource";

const CONCURRENCY = 3;

async function processInParallel<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item === undefined) continue;
      results[idx] = await worker(item, idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runDocumentationJob(
  jobId: string,
  selectedScreenPaths: string[]
): Promise<void> {
  const total = selectedScreenPaths.length;

  jobStore.update(jobId, {
    status: "running",
    progress: { current: 0, total, message: "Bağlam kaynakları yükleniyor..." },
  });

  emitJobEvent(jobId, {
    type: "progress",
    message: `Bağlam yükleniyor (Swagger + BRD + Confluence + şablonlar)...`,
    current: 0,
    total,
  });

  // ── Load all context sources ─────────────────────────────────────
  const allEndpoints: Endpoint[] = [];

  // 1. Local swagger files
  const swaggerFiles = readSwaggerFiles();
  for (const sf of swaggerFiles) {
    allEndpoints.push(...extractEndpoints(sf.content, sf.fileName));
  }

  // 2. Swagger references (fetched URLs)
  for (const swagRef of referenceStore.getAllSwagger()) {
    if (fs.existsSync(swagRef.specFile)) {
      try {
        const spec = JSON.parse(fs.readFileSync(swagRef.specFile, "utf-8")) as Record<string, unknown>;
        allEndpoints.push(...extractEndpoints(spec, swagRef.name));
      } catch {
        // ignore parse errors
      }
    }
  }

  const allSections: DocumentSection[] = [];

  // 3. BRD docs (local markdown files)
  const brdDocs = loadDocuments({
    type: "brd",
    directory: "data/brd",
    extension: ".md",
  });
  for (const doc of brdDocs) {
    allSections.push(...parseBrdSections(doc.content, doc.fileName));
  }

  // 4. Uploaded reference documents (.docx → text)
  for (const docRef of referenceStore.getDocuments()) {
    if (docRef.type === "template") continue; // templates handled separately
    if (fs.existsSync(docRef.contentFile)) {
      const content = fs.readFileSync(docRef.contentFile, "utf-8");
      allSections.push(...parseBrdSections(content, docRef.originalName));
    }
  }

  // 5. Stored Confluence references (pulled via Referanslar)
  for (const conf of referenceStore.getAllConfluence()) {
    if (fs.existsSync(conf.contentFile)) {
      const content = fs.readFileSync(conf.contentFile, "utf-8");
      allSections.push({
        title: conf.title,
        content,
        sourceType: "confluence",
        sourceFile: conf.title,
      });
    }
  }

  // 6. Legacy: live Confluence space scan (if configured)
  try {
    const confluenceSections = await readConfluencePages();
    allSections.push(...confluenceSections);
  } catch {
    // skip if not configured
  }

  // 7. Load templates for style reference
  const templateContents: string[] = [];
  for (const tplRef of referenceStore.getDocuments("template")) {
    if (fs.existsSync(tplRef.contentFile)) {
      templateContents.push(fs.readFileSync(tplRef.contentFile, "utf-8"));
    }
  }

  emitJobEvent(jobId, {
    type: "progress",
    message: `Bağlam hazır: ${allEndpoints.length} endpoint, ${allSections.length} döküman bölümü, ${templateContents.length} şablon`,
    current: 0,
    total,
  });

  // ── Process screens in parallel (with concurrency limit) ─────────
  let completed = 0;

  await processInParallel(selectedScreenPaths, CONCURRENCY, async (screenPath, _idx) => {
    if (jobCancellation.isCancelled(jobId)) return;

    const storedScreen = screenStore.getByPath(screenPath);
    if (!storedScreen) {
      emitJobEvent(jobId, {
        type: "error",
        message: `Ekran bulunamadı: ${screenPath}`,
        current: ++completed,
        total,
      });
      return;
    }

    const screenTitle = storedScreen.title || screenPath;

    emitJobEvent(jobId, {
      type: "progress",
      message: `Analiz ediliyor: ${screenTitle}`,
      current: completed,
      total,
    });

    try {
      const screen = screenStore.toDiscoveredScreen(storedScreen);
      const analysis = await analyzeScreen(screen);
      const context = buildScreenContext(screen, analysis, allSections, allEndpoints);

      emitJobEvent(jobId, {
        type: "progress",
        message: `Döküman yazılıyor: ${screenTitle}`,
        current: completed,
        total,
      });

      const [userManual, technical] = await Promise.all([
        generateUserManualSection(context, templateContents),
        generateTechnicalDocSection(context, templateContents),
      ]);

      documentStore.create({
        id: uuid(),
        jobId,
        screenPath,
        screenTitle: analysis.screenTitle || screenTitle,
        screenshotPath: storedScreen.screenshotPath,
        userManualContent: userManual.content,
        technicalDocContent: technical.content,
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        inputTokens: userManual.inputTokens + technical.inputTokens,
        outputTokens: userManual.outputTokens + technical.outputTokens,
      });

      completed++;
      jobStore.update(jobId, {
        progress: { current: completed, total, message: `Tamamlandı: ${screenTitle}` },
      });

      emitJobEvent(jobId, {
        type: "screen",
        message: `✓ ${screenTitle}`,
        current: completed,
        total,
        data: { screenPath, screenTitle },
      });
    } catch (err) {
      completed++;
      emitJobEvent(jobId, {
        type: "error",
        message: `Hata (${screenTitle}): ${(err as Error).message}`,
        current: completed,
        total,
      });
    }
  });

  const wasCancelled = jobCancellation.isCancelled(jobId);
  jobCancellation.clear(jobId);

  jobStore.update(jobId, {
    status: wasCancelled ? "failed" : "completed",
    completedAt: new Date().toISOString(),
    progress: {
      current: completed,
      total,
      message: wasCancelled ? "Kullanıcı tarafından iptal edildi" : "Tüm dökümanlar oluşturuldu",
    },
    ...(wasCancelled ? { error: "Cancelled by user" } : {}),
  });

  emitJobEvent(jobId, {
    type: wasCancelled ? "error" : "complete",
    message: wasCancelled ? "İptal edildi" : "Tüm dökümanlar oluşturuldu",
    current: completed,
    total,
  });
}
