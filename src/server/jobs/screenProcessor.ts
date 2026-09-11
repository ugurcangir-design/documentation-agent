/**
 * Tek bir ekran için uçtan uca doküman üretim adımı:
 *   analyzeScreen → buildScreenContext → generateUserManualComplete
 *   → coverage + fix-up döngüsü → trace footer + documentStore.create
 *
 * documentationJob bunu CONCURRENCY=3 ile paralel çalıştırır.
 */

import { v4 as uuid } from "uuid";

import { analyzeScreen } from "../../analysis/screenAnalyzer";
import { buildScreenContext } from "../../analysis/screenContextBuilder";
import { generateUserManualComplete, SECTION_JOINER } from "../../generator/userManualGenerator";
import { computeCoverage, type CoverageReport } from "../../quality/coverageCheck";
import { computeVerifiedCoverage } from "../../quality/verifiedCoverage";
import { runCoverageFixUp } from "../../generator/coverageFixUp";
import { isSidebarNav } from "../../quality/sidebarNav";
import { isUsageLimitError, type ClaudeImage } from "../../llm/claudeClient";
import { screenStore, type StoredScreen } from "../store/screenStore";
import { documentStore } from "../store/documentStore";
import { jobStore } from "../store/jobStore";
import { referenceStore } from "../store/referenceStore";
import { emitJobEvent } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";
import { buildTrace } from "./traceBuilder";
import { env } from "../../config/env";
import { fetchLiveAppEvidence } from "../../browser/liveAppMcp";
import { runStyleLint } from "../../quality/styleLint";
import { computeDocFingerprint, docHasQualityWarning } from "../../quality/docFingerprint";

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
  /** Job başında bir kez tespit edilen prompt yapılandırma sorunları
   *  (checkPromptConfigHealth). Boş değilse doküman-başı uyarı basılır. */
  promptConfigProblems?: string[];
  /** Üretim-config parmak izi (job-stable) — artımlı üretim skip'i için. */
  genFp: string;
  /** true → parmak izi eşleşse bile yeniden üret (kullanıcı "force" seçti). */
  force?: boolean;
}

export interface ProcessResult {
  /** Üretim atlandı mı (değişmedi → mevcut doküman korundu, 0 token). */
  skipped: boolean;
  /** "Yumuşak" uyarı etiketleri (doküman üretildi ama eksik/şüpheli olabilir). */
  warnings: string[];
}

/** Tek ekran: analiz + (artımlı skip kontrolü) + üretim + doğrulama + persist.
 *  Ekran hata verirse / erken çıkarsa `{skipped:false, warnings:[]}` döner. */
export async function processScreen(args: ProcessArgs): Promise<ProcessResult> {
  const { jobId, screenPath, allSections, allEndpoints, templateContents, total,
    getCompleted, incCompleted, promptConfigProblems, genFp, force } = args;

  console.log(`[docjob ${jobId}] worker başladı: ${screenPath}`);

  if (!(await jobCancellation.waitIfPaused(jobId))) {
    console.log(`[docjob ${jobId}] worker bailed (pause+cancel) for ${screenPath}`);
    return { skipped: false, warnings: [] };
  }
  if (jobCancellation.isCancelled(jobId)) {
    console.log(`[docjob ${jobId}] worker bailed (cancelled) for ${screenPath}`);
    return { skipped: false, warnings: [] };
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
    return { skipped: false, warnings: [] };
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

    // ── Artımlı üretim: girdi parmak izi değişmediyse ÜRETİMİ ATLA ──────
    // Analiz (ucuz/cache'li) yapıldı; asıl pahalı olan ÜRETİM'i, ekranın
    // çıktı-belirleyici girdileri (analiz + bu ekrana seçilmiş RAG chunk'ları
    // + state'ler + üretim-config) önceki dokümandakiyle AYNIysa atlıyoruz →
    // 0 token. Mevcut doküman eksik/uyarılı ise atlanmaz (düzeltme şansı).
    const stateLabels = (storedScreen.states ?? []).map((s) => s.label);
    const fingerprint = computeDocFingerprint({
      analysis, preparedChunks: context.preparedChunks, stateLabels, genFp,
    });
    if (!force) {
      const existing = documentStore.getLatestByScreenPath(screenPath);
      if (existing && existing.inputFingerprint === fingerprint && !docHasQualityWarning(existing.userManualContent)) {
        const completed = incCompleted();
        console.log(`[docjob ${jobId}] ${screenTitle}: değişmedi — üretim atlandı (parmak izi eşleşti, 0 token)`);
        jobStore.update(jobId, { progress: { current: completed, total, message: `Değişmedi, atlandı: ${screenTitle}` } });
        emitJobEvent(jobId, {
          type: "screen",
          message: `↺ ${screenTitle} (değişmedi, atlandı)`,
          current: completed, total,
          data: { screenPath, screenTitle },
        });
        return { skipped: true, warnings: [] };
      }
    }

    // Canlı uygulama kanıtı (opsiyonel, LIVE_APP_MCP_ENABLED) — Claude'un
    // gerçek ekranı MCP ile gezip topladığı network/CRUD/mesaj gözlemi.
    // Kapalıyken/hatada null döner, pipeline etkilenmez (bkz. liveAppMcp.ts).
    if (env.liveAppMcpEnabled) setProgress(`${screenTitle} — canlı uygulama gözlemi (MCP) çalışıyor…`);
    const liveAppEvidence = env.liveAppMcpEnabled
      ? await fetchLiveAppEvidence(screen).catch((e) => {
          console.warn(`[docjob ${jobId}] live-app-mcp beklenmeyen hata (${screenTitle}): ${(e as Error).message}`);
          return null;
        })
      : null;
    if (liveAppEvidence) setProgress(`${screenTitle} — canlı uygulama kanıtı toplandı`);

    setProgress(`Kullanıcı kılavuzu yazılıyor: ${screenTitle}`);

    // Yalnız KULLANICI KILAVUZU üretilir — teknik doküman özelliği kaldırıldı.
    // Çok sekmeli ekranlarda sekme-başına ilerleme mesajı yayınla (UI donmasın).
    const userManual = await generateUserManualComplete(context, templateContents,
      (msg) => setProgress(`${screenTitle} — ${msg}`), liveAppEvidence ?? undefined);

    // Coverage scope = analyzer'ın çıkardığı UI öğeleri, sidebar nav hariç.
    const inScopeForCoverage = analysis.uiElements.filter((el) => !isSidebarNav(el));

    // Fix-up ve coverage-judge'a verilecek ekran görselleri (ana ekran +
    // state'ler). Fix-up eskiden GÖRSELSİZ çalışıp eksik öğeyi uyduruyordu;
    // artık ana üretimle aynı görsel kanıtı görür (bkz. coverageFixUp UYDURMA
    // YASAK). State sayısı bant genişliği için sınırlı tutulur.
    const screenImages: ClaudeImage[] = (screen.states ?? [])
      .slice(0, 10)
      .map((s) => ({ base64: s.screenshotBase64, path: s.screenshotPath, label: s.label }));

    // Fix-up (yeniden yazma) HEDEFİ hâlâ yalnız GENEL BAKIŞ bölümüdür (token
    // tasarrufu: sekme bölümleri kendi görsellerinden üretilir, yeniden
    // yazılmaz). ANCAK kapsam ÖLÇÜMÜ artık TÜM dokümana (genel bakış + sekmeler)
    // karşı yapılır: bir öğe sekme bölümünde anlatıldıysa "covered" sayılır →
    // (1) sahte-düşük kapsam ortadan kalkar, (2) sekmede zaten anlatılan öğe
    // genel bakışa tekrar EKLENMEZ (çift içerik önlenir), (3) footer'daki %
    // dokümanın TAMAMINI temsil eder. Yalnız hiçbir yerde geçmeyen (ana ekran)
    // öğe fix-up ile genel bakışa eklenir.
    const isMultiTab = userManual.overviewContent !== undefined;
    const tabsContent = userManual.tabsContent ?? "";
    let coverageTarget = isMultiTab ? (userManual.overviewContent as string) : userManual.content;
    const tabsSuffix = isMultiTab && tabsContent ? SECTION_JOINER + tabsContent : "";

    const initialUmCoverage = env.coverageLlmJudge
      ? await computeVerifiedCoverage(inScopeForCoverage, coverageTarget + tabsSuffix, {
          base64: screen.screenshotBase64, path: screen.screenshotPath,
        })
      : computeCoverage(inScopeForCoverage, coverageTarget + tabsSuffix);
    let umCoverage = initialUmCoverage;
    let umExtraTokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    let umFixUpAdded = 0;

    console.log(
      `[docjob ${jobId}] Coverage (initial${env.coverageLlmJudge ? ", LLM-judged" : ""}): ` +
      `userManual=${umCoverage.coveragePct}% (${umCoverage.coveredElements}/${umCoverage.totalElements})`
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
          message: `Kullanıcı kılavuzu kapsamı %${curCov.coveragePct} — eksik ${curCov.missing.length} öğe için fix-up (tur ${pass})`,
          current: getCompleted(),
          total,
        });
        try {
          const fix = await runCoverageFixUp({
            currentContent: curContent,
            missing: curCov.missing,
            uiElementsMissing: missingAsElements(curCov.missing),
            screenTitle,
            // Görsel kanıt — eksik öğe uydurmasın, ekrandan anlatsın.
            ...(screen.screenshotBase64 ? { mainImageBase64: screen.screenshotBase64 } : {}),
            ...(screen.screenshotPath ? { mainImagePath: screen.screenshotPath } : {}),
            images: screenImages,
          });
          // Kapsam TÜM dokümana karşı ölçülür (düzeltilmiş genel bakış +
          // değişmeyen sekmeler) — fix.content yalnız genel bakışı yeniden yazar.
          const newCov = computeCoverage(inScopeForCoverage, fix.content + tabsSuffix);
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
            console.log(`[docjob ${jobId}] fix-up tur ${pass}: %${prev} → %${curCov.coveragePct}${missingUnchanged ? " (eksik set sabit)" : ""}`);
            if (missingUnchanged) break;
          } else {
            console.log(`[docjob ${jobId}] fix-up tur ${pass} regresyon (%${newCov.coveragePct}) — atlandı`);
            break;
          }
        } catch (e) {
          console.warn(`[docjob ${jobId}] fix-up başarısız:`, (e as Error).message);
          break;
        }
      }
      return { content: curContent, coverage: curCov, addedTotal, tokensIn, tokensOut, cacheRead, cacheCreate };
    }

    {
      const r = await fixUpLoop(coverageTarget, umCoverage);
      coverageTarget = r.content; // düzeltilmiş genel bakış (çok-sekmede)
      umCoverage = r.coverage;
      umFixUpAdded = r.addedTotal;
      umExtraTokens = { input: r.tokensIn, output: r.tokensOut, cacheRead: r.cacheRead, cacheCreate: r.cacheCreate };
    }

    // Stil denetimi (opsiyonel, ucuz Haiku): genel bakış + her sekme bölümü
    // yalnız BİÇİMSEL olarak düzeltilir (UI adları kalın, adım numaraları,
    // jargon). Guardrail'li — şüpheli çıktı reddedilir, içerik kaybolamaz.
    let finalOverview = coverageTarget;
    let finalTabs = tabsContent;
    if (env.styleLint) {
      setProgress(`Stil denetimi: ${screenTitle}`);
      const tabSections = isMultiTab && tabsContent ? tabsContent.split(SECTION_JOINER) : [];
      const lint = await runStyleLint([coverageTarget, ...tabSections]);
      finalOverview = lint.sections[0] ?? coverageTarget;
      finalTabs = tabSections.length > 0 ? lint.sections.slice(1).join(SECTION_JOINER) : tabsContent;
      umExtraTokens.input += lint.inputTokens;
      umExtraTokens.output += lint.outputTokens;
      if (lint.changed > 0) console.log(`[docjob ${jobId}] styleLint: ${lint.changed} bölümde biçimsel düzeltme`);
    }

    // Nihai içerik: çok-sekmede düzeltilmiş genel bakış + sekme bölümleri;
    // tek/sıfır sekmede düzeltilmiş tek doküman.
    const umContent = isMultiTab && finalTabs
      ? finalOverview + SECTION_JOINER + finalTabs
      : finalOverview;

    if (umCoverage.missing.length > 0) {
      console.log(`[docjob ${jobId}] UM kalan eksikler: ${umCoverage.missing.join(", ")}`);
    }

    const usedTemplates = referenceStore.getDocuments("template").map((t) => t.originalName);
    const traceArgs = { context, usedTemplates, stateCount };

    // Sessiz kaybı GÖRÜNÜR yap: doküman yine oluşturulur ama eksik/şüpheli
    // olabilecek her durum için (1) dokümanın EN BAŞINA kaçırılamaz bir uyarı
    // banner'ı, (2) canlı progress akışına bildirim, (3) job özetine kısa
    // etiket (screenWarnings). Eski davranış: 'tamamlandı' görünüp sorun
    // sessizce kayboluyordu.
    const warningBanners: string[] = [];
    const screenWarnings: string[] = [];
    const pushWarning = (banner: string, label: string, eventMsg: string) => {
      warningBanners.push(banner);
      screenWarnings.push(label);
      emitJobEvent(jobId, { type: "error", message: eventMsg, current: getCompleted(), total });
    };

    // (a) Bir/daha fazla sekme 2 denemede de üretilemedi → doküman EKSİK.
    const failedTabs = userManual.failedTabs ?? [];
    if (failedTabs.length > 0) {
      const tabList = failedTabs.join(", ");
      console.warn(`[docjob ${jobId}] ${screenTitle}: şu sekmeler üretilemedi (2 deneme sonrası): ${tabList} — doküman EKSİK`);
      pushWarning(
        `> ⚠️ **EKSİK İÇERİK UYARISI:** Şu sekme(ler) teknik bir hata nedeniyle üretilemedi ve bu dokümanda YOK: **${tabList}**. Bu dokümanı kullanmadan önce Discovery/Kılavuz sayfasından bu ekranı yeniden seçip üretin.`,
        `${screenTitle}: sekme üretilemedi (${tabList})`,
        `Uyarı (${screenTitle}): şu sekme(ler) üretilemedi — doküman EKSİK: ${tabList}. Discovery/Kılavuz sayfasından bu ekranı yeniden üretin.`
      );
    }

    // (b) Çıktı kesilmiş olabilir (max_tokens). CLI modunda artık yapısal
    // sezgiyle de tespit edilir (looksTruncated) — eskiden CLI'da hiç görülmezdi.
    if (userManual.truncated) {
      console.warn(`[docjob ${jobId}] ${screenTitle}: çıktı kesilmiş olabilir (max_tokens) — doküman yarım olabilir`);
      pushWarning(
        `> ⚠️ **ÇIKTI KESİLMİŞ OLABİLİR:** Kılavuz üretilirken model çıktı sınırına (\`max_tokens\`) takılmış görünüyor — doküman yarım kalmış olabilir. Ayarlar > Sistem Promptları'ndan \`maxTokens\` değerini artırıp bu ekranı yeniden üretin.`,
        `${screenTitle}: çıktı kesilmiş olabilir`,
        `Uyarı (${screenTitle}): çıktı kesilmiş olabilir (max_tokens) — doküman yarım olabilir. maxTokens'ı artırıp yeniden üretin.`
      );
    }

    // (c) Doğrulanacak UI öğesi yok → kapsam ÖLÇÜLEMEDİ (boş/erişilemez ekran,
    // auth-wall, tümü global nav olabilir). Kılavuz halüsinasyona en açık durum.
    if (inScopeForCoverage.length === 0) {
      console.warn(`[docjob ${jobId}] ${screenTitle}: doğrulanacak UI öğesi yok — kapsam ölçülemedi`);
      pushWarning(
        `> ⚠️ **KAPSAM ÖLÇÜLEMEDİ:** Bu ekranda doğrulanacak UI öğesi bulunamadı (ekran boş/erişilemez olabilir, ya da öğelerin tümü global nav sayıldı). Kılavuz içeriği otomatik doğrulanamadı — kullanmadan önce elle kontrol edin.`,
        `${screenTitle}: UI öğesi yok, kapsam ölçülemedi`,
        `Uyarı (${screenTitle}): doğrulanacak UI öğesi bulunamadı — kapsam ölçülemedi, içeriği elle kontrol edin.`
      );
    }

    // (d) Prompt yapılandırması eksik/bozuk (job başında bir kez tespit edildi)
    // → kritik kurallar ("uydurma yasak") ve çıktı yapısı devrede olmayabilir.
    if (promptConfigProblems && promptConfigProblems.length > 0) {
      warningBanners.push(
        `> ⚠️ **PROMPT YAPILANDIRMASI EKSİK:** ${promptConfigProblems.join("; ")}. Kritik üretim kuralları ("uydurma yasak") ve çıktı yapısı devrede olmayabilir — çıktının doğruluğunu elle doğrulayın.`
      );
      screenWarnings.push(`prompt yapılandırması eksik`);
      // Not: canlı akış bildirimi documentationJob'da bir kez basılır (job-stable).
    }

    // (e) LLM-judge çalışması gerekiyordu ama başarısız oldu → kapsam ham
    // metin eşleşmesine göre; "her öğe anlamlı anlatıldı" DOĞRULANMADI.
    if (env.coverageLlmJudge && umCoverage.verified === false) {
      pushWarning(
        `> ⚠️ **KAPSAM DOĞRULANAMADI:** Kapsam doğrulaması (LLM-judge) teknik bir hata nedeniyle çalışamadı. Kapsam yüzdesi yalnız ham metin eşleşmesine dayanıyor — kılavuzun her öğeyi **anlamlı** anlattığı doğrulanmadı. İçeriği elle gözden geçirin.`,
        `${screenTitle}: kapsam doğrulaması yapılamadı`,
        `Uyarı (${screenTitle}): kapsam doğrulaması (LLM-judge) çalışamadı — kapsam ham eşleşmeye göre, elle kontrol edin.`
      );
    }

    const docHeadWarning = warningBanners.length > 0
      ? warningBanners.join("\n\n") + "\n\n---\n\n"
      : "";

    documentStore.create({
      id: uuid(),
      jobId,
      screenPath,
      screenTitle: analysis.screenTitle || screenTitle,
      screenshotPath: storedScreen.screenshotPath,
      userManualContent: docHeadWarning + umContent + buildTrace({
        ...traceArgs, coverage: umCoverage, fixUpAdded: umFixUpAdded, truncated: !!userManual.truncated,
      }),
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputTokens: userManual.inputTokens + umExtraTokens.input,
      outputTokens: userManual.outputTokens + umExtraTokens.output,
      cacheReadTokens: (userManual.cacheReadTokens ?? 0) + umExtraTokens.cacheRead,
      cacheCreationTokens: (userManual.cacheCreationTokens ?? 0) + umExtraTokens.cacheCreate,
      inputFingerprint: fingerprint,
    });

    const completed = incCompleted();
    jobStore.update(jobId, {
      progress: { current: completed, total, message: `Tamamlandı: ${screenTitle}` },
    });
    emitJobEvent(jobId, {
      type: "screen",
      message: screenWarnings.length > 0 ? `⚠ ${screenTitle} (${screenWarnings.length} uyarı)` : `✓ ${screenTitle}`,
      current: completed,
      total,
      data: { screenPath, screenTitle },
    });
    return { skipped: false, warnings: screenWarnings };
  } catch (err) {
    const completed = incCompleted();
    const errMsg = (err as Error).message;
    const errStack = (err as Error).stack;
    console.error(`[docjob ${jobId}] ERROR for ${screenTitle}: ${errMsg}`);
    if (errStack) console.error(errStack);

    // Abonelik/kullanım limiti → yarım doküman YOK (generateUserManualComplete
    // temiz fırlattı). Kullanıcıya NET, eyleme dönük mesaj; job'a kaydet ki
    // finalize terminal mesajı da bunu göstersin.
    if (isUsageLimitError(err)) {
      const limitMsg =
        "⛔ Claude kullanım limiti nedeniyle üretim durdu — yarım doküman oluşturulmadı. " +
        "Limit sıfırlanınca veya Ayarlar'dan API moduna geçince Geçmiş → 'Eksikleri Üret' ile tamamlayın.";
      jobStore.update(jobId, { error: limitMsg });
      emitJobEvent(jobId, { type: "error", message: `${screenTitle}: ${limitMsg}`, current: completed, total });
    } else {
      emitJobEvent(jobId, {
        type: "error",
        message: `Hata (${screenTitle}): ${errMsg}`,
        current: completed,
        total,
      });
    }
    return { skipped: false, warnings: [] };
  }
}

// Re-export type kullanım kolaylığı için
export type { StoredScreen };
