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
import { cleanReferenceText, decodeHtmlEntities } from "../../quality/referenceTextCleaner";

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

  let allSections: DocumentSection[] = [];

  // 3. BRD docs (local markdown files)
  const brdDocs = loadDocuments({
    type: "brd",
    directory: "data/brd",
    extension: ".md",
  });
  for (const doc of brdDocs) {
    allSections.push(...parseBrdSections(doc.content, doc.fileName));
  }

  // 4. Uploaded reference documents (.docx/.pdf → text). PDF-extracted
  //    text is cleaned of TOC dot-leaders, page markers and running
  //    headers before sectioning so retrieval works on real prose.
  for (const docRef of referenceStore.getDocuments()) {
    if (docRef.type === "template") continue; // templates handled separately
    if (fs.existsSync(docRef.contentFile)) {
      const raw = fs.readFileSync(docRef.contentFile, "utf-8");
      const content = cleanReferenceText(raw);
      allSections.push(...parseBrdSections(content, docRef.originalName));
    }
  }

  // 5. Stored Confluence references (pulled via Referanslar).
  //    Decode HTML entities (&uuml; etc.) + strip PDF/TOC noise so the
  //    Confluence page is usable context, not entity soup.
  for (const conf of referenceStore.getAllConfluence()) {
    if (fs.existsSync(conf.contentFile)) {
      const raw = fs.readFileSync(conf.contentFile, "utf-8");
      const content = cleanReferenceText(decodeHtmlEntities(raw));
      allSections.push({
        id: `confluence_${conf.pageId}`,
        sourceId: `confluence_${conf.pageId}`,
        title: conf.title,
        content,
        sourceType: "confluence",
        sourceFile: conf.title,
      });
    }
  }

  // 5b. Synced Jira issues (pulled via Veri Kaynakları). Each issue
  //     becomes its own section so retrieval can pinpoint a single
  //     ticket rather than drowning in a whole project dump.
  for (const jira of referenceStore.getAllJira()) {
    if (!fs.existsSync(jira.contentFile)) continue;
    try {
      const issues = JSON.parse(fs.readFileSync(jira.contentFile, "utf-8")) as Array<{
        key: string;
        summary?: string;
        status?: string;
        type?: string;
        description?: string;
      }>;
      for (const issue of issues) {
        const body = [
          issue.type ? `Tip: ${issue.type}` : "",
          issue.status ? `Durum: ${issue.status}` : "",
          issue.description ?? "",
        ]
          .filter(Boolean)
          .join("\n");
        if (!body.trim()) continue;
        allSections.push({
          id: `jira_${issue.key}`,
          sourceId: `jira_${jira.projectKey}`,
          title: `${issue.key} — ${issue.summary ?? ""}`.trim(),
          content: body,
          sourceType: "jira_task",
          sourceFile: `${jira.projectKey} (Jira)`,
        });
      }
    } catch {
      // skip malformed jira dump
    }
  }

  // 6. Legacy: live Confluence space scan via env.confluenceSpaceKey.
  //    Superseded by the "Veri Kaynakları" feature. Only runs as a
  //    fallback when no Confluence space source has been registered, so
  //    a synced space is never also scanned live (no double read).
  if (referenceStore.getSources("confluence-space").length === 0) {
    try {
      const confluenceSections = await readConfluencePages();
      allSections.push(...confluenceSections);
    } catch {
      // skip if not configured
    }
  }

  // 7. Load templates for style reference — cleaned so the model sees
  //    real guide prose, not 7000 chars of table-of-contents dots.
  const templateContents: string[] = [];
  for (const tplRef of referenceStore.getDocuments("template")) {
    if (fs.existsSync(tplRef.contentFile)) {
      const raw = fs.readFileSync(tplRef.contentFile, "utf-8");
      templateContents.push(cleanReferenceText(raw));
    }
  }

  // De-duplicate synced sections by id. A Confluence page can reach
  // `allSections` from both the synced space (step 5) and an individually
  // added page URL (step 5) or the legacy env scan (step 6) — all share
  // `confluence_<pageId>`. Reading it twice skews retrieval scoring and
  // wastes prompt budget. Scoped to confluence_/jira_ ids (which we mint
  // ourselves and know are stable); BRD sections are left untouched so
  // two same-titled headings are never collapsed.
  {
    const seen = new Set<string>();
    const before = allSections.length;
    allSections = allSections.filter((s) => {
      const isSynced = s.id.startsWith("confluence_") || s.id.startsWith("jira_");
      if (!isSynced) return true;
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    const removed = before - allSections.length;
    if (removed > 0) {
      console.log(`[docjob ${jobId}] ${removed} yinelenen referans bölümü temizlendi (çift okuma engellendi)`);
    }
  }

  emitJobEvent(jobId, {
    type: "progress",
    message: `Bağlam hazır: ${allEndpoints.length} endpoint, ${allSections.length} döküman bölümü, ${templateContents.length} şablon`,
    current: 0,
    total,
  });

  // Source-type inventory — proves every reference kind reached context.
  const sectionsByType = allSections.reduce<Record<string, number>>((acc, s) => {
    acc[s.sourceType] = (acc[s.sourceType] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`[docjob ${jobId}] CONTEXT INVENTORY:`);
  console.log(`  - Endpoints: ${allEndpoints.length}`);
  console.log(`  - BRD/Confluence sections: ${allSections.length}`);
  console.log(`  - Section types: ${JSON.stringify(sectionsByType)}`);
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

      // ── Targeted fix-up — loop up to 2 passes until coverage ≥90% ──
      const FIX_UP_THRESHOLD = 90;
      const MAX_FIX_UP_PASSES = 2;
      const labelToElement = new Map(inScopeForCoverage.map((el) => [el.label.toLowerCase(), el]));
      const missingAsElements = (missing: string[]) =>
        missing
          .map((m) => {
            const label = m.replace(/\s*\([^)]+\)\s*$/, "").trim();
            return labelToElement.get(label.toLowerCase());
          })
          .filter((el): el is NonNullable<typeof el> => Boolean(el));

      // Run fix-up passes for a doc until coverage hits the threshold,
      // it stops improving, or we hit the pass cap.
      async function fixUpLoop(
        docKind: "userManual" | "technicalDoc",
        content: string,
        coverage: ReturnType<typeof computeCoverage>
      ): Promise<{ content: string; coverage: typeof coverage; addedTotal: number; tokensIn: number; tokensOut: number }> {
        let curContent = content;
        let curCov = coverage;
        let addedTotal = 0;
        let tokensIn = 0;
        let tokensOut = 0;

        for (let pass = 1; pass <= MAX_FIX_UP_PASSES; pass++) {
          if (curCov.coveragePct >= FIX_UP_THRESHOLD || curCov.missing.length === 0) break;
          emitJobEvent(jobId, {
            type: "progress",
            message: `${docKind === "userManual" ? "Kullanıcı kılavuzu" : "Teknik döküman"} kapsamı %${curCov.coveragePct} — eksik ${curCov.missing.length} öğe için fix-up (tur ${pass})`,
            current: completed,
            total,
          });
          try {
            const fix = await runCoverageFixUp({
              docKind,
              currentContent: curContent,
              missing: curCov.missing,
              uiElementsMissing: missingAsElements(curCov.missing),
              screenTitle,
            });
            const newCov = computeCoverage(inScopeForCoverage, fix.content);
            tokensIn += fix.inputTokens;
            tokensOut += fix.outputTokens;
            // Accept the rewrite only if it didn't regress coverage
            if (newCov.coveragePct >= curCov.coveragePct) {
              curContent = fix.content;
              addedTotal += fix.addedCount;
              const prev = curCov.coveragePct;
              curCov = newCov;
              console.log(`[docjob ${jobId}] ${docKind} fix-up tur ${pass}: %${prev} → %${curCov.coveragePct}`);
              if (curCov.coveragePct === prev) break; // no improvement → stop
            } else {
              console.log(`[docjob ${jobId}] ${docKind} fix-up tur ${pass} regresyon (%${newCov.coveragePct}) — atlandı`);
              break;
            }
          } catch (e) {
            console.warn(`[docjob ${jobId}] ${docKind} fix-up başarısız:`, (e as Error).message);
            break;
          }
        }
        return { content: curContent, coverage: curCov, addedTotal, tokensIn, tokensOut };
      }

      {
        const r = await fixUpLoop("userManual", umContent, umCoverage);
        umContent = r.content;
        umCoverage = r.coverage;
        umFixUpAdded = r.addedTotal;
        umExtraTokens = { input: r.tokensIn, output: r.tokensOut };
      }
      {
        const r = await fixUpLoop("technicalDoc", tdContent, tdCoverage);
        tdContent = r.content;
        tdCoverage = r.coverage;
        tdFixUpAdded = r.addedTotal;
        tdExtraTokens = { input: r.tokensIn, output: r.tokensOut };
      }

      if (umCoverage.missing.length > 0) {
        console.log(`[docjob ${jobId}] UM kalan eksikler: ${umCoverage.missing.join(", ")}`);
      }

      // Append a retrieval-trace footer so the analyst sees exactly
      // which BRD chunks, API endpoints and templates fed the doc.
      const usedTemplates = referenceStore.getDocuments("template").map((t) => t.originalName);
      const SOURCE_TYPE_LABELS: Record<string, string> = {
        brd: "BRD",
        confluence: "Confluence",
        jira_task: "Jira",
        process_analysis: "Süreç Analizi",
        manual: "Manuel",
      };
      const chunkTypeBreakdown = Object.entries(
        context.preparedChunks.reduce<Record<string, number>>((acc, c) => {
          acc[c.sourceType] = (acc[c.sourceType] ?? 0) + 1;
          return acc;
        }, {})
      )
        .map(([t, n]) => `${SOURCE_TYPE_LABELS[t] ?? t} ${n}`)
        .join(", ");
      const buildTrace = (cov: typeof umCoverage, fixUpAdded: number) => [
        `\n\n---`,
        `### Üretim Bilgisi`,
        `Bu döküman aşağıdaki kaynaklarla üretildi:`,
        `- **Referans bölümleri** (${context.preparedChunks.length}${chunkTypeBreakdown ? ` — ${chunkTypeBreakdown}` : ""}): ${context.preparedChunks.map((c) => c.title).slice(0, 8).join(", ") || "(yok)"}`,
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
