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
import { computeCoverage } from "../../quality/coverageCheck";
import { runCoverageFixUp } from "../../generator/coverageFixUp";

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

  console.log(`[docjob ${jobId}] CONTEXT INVENTORY:`);
  console.log(`  - Endpoints: ${allEndpoints.length}`);
  console.log(`  - BRD/Confluence sections: ${allSections.length}`);
  console.log(`  - Templates: ${templateContents.length} (total chars: ${templateContents.reduce((s, t) => s + t.length, 0)})`);
  if (allSections.length > 0) {
    console.log(`  - First 3 sections: ${allSections.slice(0, 3).map(s => `'${s.title}'`).join(", ")}`);
  }

  // ── Process screens in parallel (with concurrency limit) ─────────
  let completed = 0;

  console.log(`[docjob ${jobId}] starting with ${selectedScreenPaths.length} paths`);

  console.log(`[docjob ${jobId}] worker loop için ${selectedScreenPaths.length} path: ${JSON.stringify(selectedScreenPaths)}`);

  await processInParallel(selectedScreenPaths, CONCURRENCY, async (screenPath, _idx) => {
    console.log(`[docjob ${jobId}] worker başladı: ${screenPath}`);

    if (!(await jobCancellation.waitIfPaused(jobId))) {
      console.log(`[docjob ${jobId}] worker bailed (pause+cancel) for ${screenPath}`);
      return;
    }
    if (jobCancellation.isCancelled(jobId)) {
      console.log(`[docjob ${jobId}] worker bailed (cancelled) for ${screenPath}`);
      return;
    }

    const storedScreen = screenStore.getByPath(screenPath);
    if (!storedScreen) {
      const allPaths = screenStore.getAll().map(s => s.path);
      console.error(`[docjob ${jobId}] EKRAN BULUNAMADI: '${screenPath}'. Mevcut paths: ${JSON.stringify(allPaths)}`);
      emitJobEvent(jobId, {
        type: "error",
        message: `Ekran bulunamadı: ${screenPath}`,
        current: ++completed,
        total,
      });
      return;
    }
    console.log(`[docjob ${jobId}] screen bulundu: ${storedScreen.title} (${storedScreen.states?.length ?? 0} state)`);

    const screenTitle = storedScreen.title || screenPath;
    const stateCount = storedScreen.states?.length ?? 0;

    const setProgress = (msg: string) => {
      jobStore.update(jobId, { progress: { current: completed, total, message: msg } });
      emitJobEvent(jobId, { type: "progress", message: msg, current: completed, total });
    };

    setProgress(`Ekran analiz ediliyor: ${screenTitle} (${stateCount} state ile)`);

    try {
      const screen = screenStore.toDiscoveredScreen(storedScreen);
      const analysis = await analyzeScreen(screen);
      const context = buildScreenContext(screen, analysis, allSections, allEndpoints);

      setProgress(`Kullanıcı kılavuzu + teknik döküman yazılıyor: ${screenTitle}`);

      const [userManual, technical] = await Promise.all([
        generateUserManualSection(context, templateContents),
        generateTechnicalDocSection(context, templateContents),
      ]);

      // Coverage check — verify each in-scope UI element is mentioned
      // in the manual. Sidebar/global nav is excluded the same way the
      // generator prompt excludes it.
      const SIDEBAR_NAV_HINTS = [
        "sport base data", "sports", "categories", "competitions", "market setup",
        "priority settings", "venues", "competitors", "heroes", "multi feed",
        "sport mapping", "market mapping", "definitions", "event management",
        "outright program", "live program", "newspaper program", "v-sport program",
      ];
      const inScopeForCoverage = analysis.uiElements.filter((el) => {
        if (el.type === "menu") return false;
        const lbl = el.label.toLowerCase().trim();
        return !SIDEBAR_NAV_HINTS.some((h) => lbl === h || lbl.startsWith(h + " "));
      });
      let umContent = userManual.content;
      let tdContent = technical.content;
      let umCoverage = computeCoverage(inScopeForCoverage, umContent);
      let tdCoverage = computeCoverage(inScopeForCoverage, tdContent);
      let umExtraTokens = { input: 0, output: 0 };
      let tdExtraTokens = { input: 0, output: 0 };
      let umFixUpAdded = 0;
      let tdFixUpAdded = 0;

      console.log(
        `[docjob ${jobId}] Coverage (initial): userManual=${umCoverage.coveragePct}% (${umCoverage.coveredElements}/${umCoverage.totalElements})  ` +
        `technicalDoc=${tdCoverage.coveragePct}% (${tdCoverage.coveredElements}/${tdCoverage.totalElements})`
      );

      // ── Targeted fix-up when coverage < 70% ──────────────────────
      const FIX_UP_THRESHOLD = 70;
      const labelToElement = new Map(inScopeForCoverage.map((el) => [el.label.toLowerCase(), el]));
      const missingAsElements = (missing: string[]) =>
        missing
          .map((m) => {
            // missing strings look like "Sayfalama (other)" — strip parens
            const label = m.replace(/\s*\([^)]+\)\s*$/, "").trim();
            return labelToElement.get(label.toLowerCase());
          })
          .filter((el): el is NonNullable<typeof el> => Boolean(el));

      if (umCoverage.coveragePct < FIX_UP_THRESHOLD && umCoverage.missing.length > 0) {
        emitJobEvent(jobId, {
          type: "progress",
          message: `Kullanıcı kılavuzu kapsamı %${umCoverage.coveragePct} — eksik ${umCoverage.missing.length} öğe için fix-up uygulanıyor`,
          current: completed,
          total,
        });
        try {
          const fix = await runCoverageFixUp({
            docKind: "userManual",
            currentContent: umContent,
            missing: umCoverage.missing,
            uiElementsMissing: missingAsElements(umCoverage.missing),
            screenTitle,
          });
          umContent = fix.content;
          umExtraTokens = { input: fix.inputTokens, output: fix.outputTokens };
          umFixUpAdded = fix.addedCount;
          umCoverage = computeCoverage(inScopeForCoverage, umContent);
          console.log(`[docjob ${jobId}] UM fix-up uygulandı → ${umCoverage.coveragePct}%`);
        } catch (e) {
          console.warn(`[docjob ${jobId}] UM fix-up başarısız:`, (e as Error).message);
        }
      }

      if (tdCoverage.coveragePct < FIX_UP_THRESHOLD && tdCoverage.missing.length > 0) {
        emitJobEvent(jobId, {
          type: "progress",
          message: `Teknik döküman kapsamı %${tdCoverage.coveragePct} — fix-up uygulanıyor`,
          current: completed,
          total,
        });
        try {
          const fix = await runCoverageFixUp({
            docKind: "technicalDoc",
            currentContent: tdContent,
            missing: tdCoverage.missing,
            uiElementsMissing: missingAsElements(tdCoverage.missing),
            screenTitle,
          });
          tdContent = fix.content;
          tdExtraTokens = { input: fix.inputTokens, output: fix.outputTokens };
          tdFixUpAdded = fix.addedCount;
          tdCoverage = computeCoverage(inScopeForCoverage, tdContent);
          console.log(`[docjob ${jobId}] TD fix-up uygulandı → ${tdCoverage.coveragePct}%`);
        } catch (e) {
          console.warn(`[docjob ${jobId}] TD fix-up başarısız:`, (e as Error).message);
        }
      }

      if (umCoverage.missing.length > 0) {
        console.log(`[docjob ${jobId}] UM kalan eksikler: ${umCoverage.missing.join(", ")}`);
      }

      // Append a retrieval-trace footer so the analyst sees exactly
      // which BRD chunks, API endpoints and templates fed the doc.
      const usedTemplates = referenceStore.getDocuments("template").map((t) => t.originalName);
      const buildTrace = (cov: typeof umCoverage, fixUpAdded: number) => [
        `\n\n---`,
        `### Üretim Bilgisi`,
        `Bu döküman aşağıdaki kaynaklarla üretildi:`,
        `- **BRD bölümleri** (${context.preparedChunks.length}): ${context.preparedChunks.map((c) => c.title).slice(0, 8).join(", ") || "(yok)"}`,
        `- **API endpoint** (${context.relatedEndpoints.length}): ${context.relatedEndpoints.slice(0, 5).map((e) => `\`${e.endpoint.method} ${e.endpoint.path}\``).join(", ") || "(yok)"}`,
        `- **Şablon** (${usedTemplates.length}): ${usedTemplates.join(", ") || "(yok)"}`,
        `- **Ekran state** (${(storedScreen.states?.length ?? 0) + 1}): 1 ana + ${storedScreen.states?.length ?? 0} test user simülasyon görüntüsü`,
        `- **UI öğesi kapsamı**: ${cov.coveragePct}% (${cov.coveredElements}/${cov.totalElements})` +
          (cov.missing.length > 0 ? ` · _Eksik: ${cov.missing.slice(0, 5).join(", ")}${cov.missing.length > 5 ? "…" : ""}_` : ""),
        ...(fixUpAdded > 0
          ? [`- **Kapsam fix-up**: ${fixUpAdded} eksik öğe için ikinci tur uygulandı`]
          : []),
        `- **Üretim**: ${new Date().toLocaleString("tr-TR")}`,
      ].join("\n");

      documentStore.create({
        id: uuid(),
        jobId,
        screenPath,
        screenTitle: analysis.screenTitle || screenTitle,
        screenshotPath: storedScreen.screenshotPath,
        userManualContent: umContent + buildTrace(umCoverage, umFixUpAdded),
        technicalDocContent: tdContent + buildTrace(tdCoverage, tdFixUpAdded),
        status: "draft",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        inputTokens: userManual.inputTokens + technical.inputTokens + umExtraTokens.input + tdExtraTokens.input,
        outputTokens: userManual.outputTokens + technical.outputTokens + umExtraTokens.output + tdExtraTokens.output,
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
      const errMsg = (err as Error).message;
      const errStack = (err as Error).stack;
      console.error(`[docjob ${jobId}] ERROR for ${screenTitle}: ${errMsg}`);
      if (errStack) console.error(errStack);
      emitJobEvent(jobId, {
        type: "error",
        message: `Hata (${screenTitle}): ${errMsg}`,
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
