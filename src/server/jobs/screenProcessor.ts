/**
 * Tek bir ekran için uçtan uca doküman üretim adımı:
 *   analyzeScreen → buildScreenContext → paralel (userManual + technicalDoc)
 *   → coverage + fix-up döngüsü → trace footer + documentStore.create
 *
 * documentationJob bunu CONCURRENCY=3 ile paralel çalıştırır.
 */

import { v4 as uuid } from "uuid";

import { analyzeScreen } from "../../analysis/screenAnalyzer";
import { buildScreenContext } from "../../analysis/screenContextBuilder";
import { generateUserManualComplete } from "../../generator/userManualGenerator";
import { generateTechnicalDocSection } from "../../generator/technicalDocGenerator";
import { computeCoverage, type CoverageReport } from "../../quality/coverageCheck";
import { computeVerifiedCoverage } from "../../quality/verifiedCoverage";
import { runCoverageFixUp } from "../../generator/coverageFixUp";
import { isSidebarNav } from "../../quality/sidebarNav";
import { screenStore, type StoredScreen } from "../store/screenStore";
import { documentStore } from "../store/documentStore";
import { jobStore } from "../store/jobStore";
import { referenceStore } from "../store/referenceStore";
import { emitJobEvent } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";
import { buildTrace } from "./traceBuilder";
import { env } from "../../config/env";

import type { Endpoint } from "../../types/endpoint";
import type { DocumentSection } from "../../types/documentSource";

export interface ProcessArgs {
  jobId: string;
  screenPath: string;
  allSections: DocumentSection[];
  allEndpoints: Endpoint[];
  templateContents: string[];
  total: number;
  /** Ortak completed sayacı — paralel worker'lar artırır. */
  getCompleted: () => number;
  incCompleted: () => number;
}

export async function processScreen(args: ProcessArgs): Promise<void> {
  const { jobId, screenPath, allSections, allEndpoints, templateContents, total,
    getCompleted, incCompleted } = args;

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
    const allPaths = screenStore.getAll().map((s) => s.path);
    console.error(`[docjob ${jobId}] EKRAN BULUNAMADI: '${screenPath}'. Mevcut: ${JSON.stringify(allPaths)}`);
    emitJobEvent(jobId, {
      type: "error",
      message: `Ekran bulunamadı: ${screenPath}`,
      current: incCompleted(),
      total,
    });
    return;
  }

  const screenTitle = storedScreen.title || screenPath;
  const stateCount = storedScreen.states?.length ?? 0;
  console.log(`[docjob ${jobId}] screen bulundu: ${storedScreen.title} (${stateCount} state)`);

  const setProgress = (msg: string) => {
    jobStore.update(jobId, { progress: { current: getCompleted(), total, message: msg } });
    emitJobEvent(jobId, { type: "progress", message: msg, current: getCompleted(), total });
  };

  setProgress(`Ekran analiz ediliyor: ${screenTitle} (${stateCount} state ile)`);

  try {
    const screen = screenStore.toDiscoveredScreen(storedScreen);
    const analysis = await analyzeScreen(screen);
    const context = buildScreenContext(screen, analysis, allSections, allEndpoints);

    setProgress(`Kullanıcı kılavuzu + teknik döküman yazılıyor: ${screenTitle}`);

    const [userManual, technical] = await Promise.all([
      generateUserManualComplete(context, templateContents),
      generateTechnicalDocSection(context, templateContents),
    ]);

    // Coverage scope = analyzer'ın çıkardığı UI öğeleri, sidebar nav hariç.
    const inScopeForCoverage = analysis.uiElements.filter((el) => !isSidebarNav(el));

    let umContent = userManual.content;
    let tdContent = technical.content;

    // İlk coverage hesabı: LLM-judge etkinse Haiku ile "anlamlı anlatıldı
    // mı?" doğrulaması yap; fix-up turu daha doğru hedeflere yönelir.
    // Fix-up iterasyonlarında raw computeCoverage kullanılır (hız +
    // maliyet; fix-up zaten eklemeyi vaadediyor, substring yeter).
    const initialCoverage = env.coverageLlmJudge
      ? (await Promise.all([
          computeVerifiedCoverage(inScopeForCoverage, umContent, "userManual"),
          computeVerifiedCoverage(inScopeForCoverage, tdContent, "technicalDoc"),
        ]))
      : [computeCoverage(inScopeForCoverage, umContent), computeCoverage(inScopeForCoverage, tdContent)];
    let umCoverage = initialCoverage[0] as CoverageReport;
    let tdCoverage = initialCoverage[1] as CoverageReport;
    let umExtraTokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    let tdExtraTokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    let umFixUpAdded = 0;
    let tdFixUpAdded = 0;

    console.log(
      `[docjob ${jobId}] Coverage (initial${env.coverageLlmJudge ? ", LLM-judged" : ""}): ` +
      `userManual=${umCoverage.coveragePct}% (${umCoverage.coveredElements}/${umCoverage.totalElements})  ` +
      `technicalDoc=${tdCoverage.coveragePct}% (${tdCoverage.coveredElements}/${tdCoverage.totalElements})`
    );

    const labelToElement = new Map(inScopeForCoverage.map((el) => [el.label.toLowerCase(), el]));
    const missingAsElements = (missing: string[]) =>
      missing
        .map((m) => {
          const label = m.replace(/\s*\([^)]+\)\s*$/, "").trim();
          return labelToElement.get(label.toLowerCase());
        })
        .filter((el): el is NonNullable<typeof el> => Boolean(el));

    async function fixUpLoop(
      docKind: "userManual" | "technicalDoc",
      content: string,
      coverage: CoverageReport
    ): Promise<{ content: string; coverage: CoverageReport; addedTotal: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheCreate: number }> {
      let curContent = content;
      let curCov = coverage;
      let addedTotal = 0;
      let tokensIn = 0;
      let tokensOut = 0;
      let cacheRead = 0;
      let cacheCreate = 0;

      const maxPasses = env.fixUpMaxPasses;
      const threshold = env.fixUpThreshold;
      for (let pass = 1; pass <= maxPasses; pass++) {
        if (curCov.coveragePct >= threshold || curCov.missing.length === 0) break;
        emitJobEvent(jobId, {
          type: "progress",
          message: `${docKind === "userManual" ? "Kullanıcı kılavuzu" : "Teknik döküman"} kapsamı %${curCov.coveragePct} — eksik ${curCov.missing.length} öğe için fix-up (tur ${pass})`,
          current: getCompleted(),
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
          cacheRead += fix.cacheReadTokens ?? 0;
          cacheCreate += fix.cacheCreationTokens ?? 0;
          if (newCov.coveragePct >= curCov.coveragePct) {
            const prev = curCov.coveragePct;
            const prevMissingSet = new Set(curCov.missing);
            const newMissingSet = new Set(newCov.missing);
            // Aynı eksik set tekrarlıyorsa (sadece sayısal eşitlik değil,
            // birebir aynı öğeler), bir sonraki turun da farklı sonuç
            // vermeyeceği kabul edilir → dur. Eksik **set'i değiştiyse**
            // (örn. bazı öğeler eklendi, başkaları çıktı; coverage % aynı
            // kalmış ama farklı öğelere yönelinmiş) tura devam ederek
            // yeni eksiklere fırsat tanı.
            const missingUnchanged =
              prevMissingSet.size === newMissingSet.size &&
              [...prevMissingSet].every((m) => newMissingSet.has(m));
            curContent = fix.content;
            addedTotal += fix.addedCount;
            curCov = newCov;
            console.log(`[docjob ${jobId}] ${docKind} fix-up tur ${pass}: %${prev} → %${curCov.coveragePct}${missingUnchanged ? " (eksik set sabit)" : ""}`);
            if (missingUnchanged) break;
          } else {
            console.log(`[docjob ${jobId}] ${docKind} fix-up tur ${pass} regresyon (%${newCov.coveragePct}) — atlandı`);
            break;
          }
        } catch (e) {
          console.warn(`[docjob ${jobId}] ${docKind} fix-up başarısız:`, (e as Error).message);
          break;
        }
      }
      return { content: curContent, coverage: curCov, addedTotal, tokensIn, tokensOut, cacheRead, cacheCreate };
    }

    {
      const r = await fixUpLoop("userManual", umContent, umCoverage);
      umContent = r.content;
      umCoverage = r.coverage;
      umFixUpAdded = r.addedTotal;
      umExtraTokens = { input: r.tokensIn, output: r.tokensOut, cacheRead: r.cacheRead, cacheCreate: r.cacheCreate };
    }
    {
      const r = await fixUpLoop("technicalDoc", tdContent, tdCoverage);
      tdContent = r.content;
      tdCoverage = r.coverage;
      tdFixUpAdded = r.addedTotal;
      tdExtraTokens = { input: r.tokensIn, output: r.tokensOut, cacheRead: r.cacheRead, cacheCreate: r.cacheCreate };
    }

    if (umCoverage.missing.length > 0) {
      console.log(`[docjob ${jobId}] UM kalan eksikler: ${umCoverage.missing.join(", ")}`);
    }

    const usedTemplates = referenceStore.getDocuments("template").map((t) => t.originalName);
    const traceArgs = { context, usedTemplates, stateCount };

    documentStore.create({
      id: uuid(),
      jobId,
      screenPath,
      screenTitle: analysis.screenTitle || screenTitle,
      screenshotPath: storedScreen.screenshotPath,
      userManualContent: umContent + buildTrace({
        ...traceArgs, coverage: umCoverage, fixUpAdded: umFixUpAdded, truncated: !!userManual.truncated,
      }),
      technicalDocContent: tdContent + buildTrace({
        ...traceArgs, coverage: tdCoverage, fixUpAdded: tdFixUpAdded, truncated: !!technical.truncated,
      }),
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputTokens: userManual.inputTokens + technical.inputTokens + umExtraTokens.input + tdExtraTokens.input,
      outputTokens: userManual.outputTokens + technical.outputTokens + umExtraTokens.output + tdExtraTokens.output,
      cacheReadTokens:
        (userManual.cacheReadTokens ?? 0) + (technical.cacheReadTokens ?? 0) +
        umExtraTokens.cacheRead + tdExtraTokens.cacheRead,
      cacheCreationTokens:
        (userManual.cacheCreationTokens ?? 0) + (technical.cacheCreationTokens ?? 0) +
        umExtraTokens.cacheCreate + tdExtraTokens.cacheCreate,
    });

    const completed = incCompleted();
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
    const completed = incCompleted();
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
}

// Re-export type kullanım kolaylığı için
export type { StoredScreen };
