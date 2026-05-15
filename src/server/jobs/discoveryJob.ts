import { BrowserSession } from "../../browser/browserSession";
import { discoverScreens } from "../../browser/screenDiscovery";
import { captureScreenshot } from "../../browser/screenshotCapture";
import {
  screenStore,
  type StoredScreen,
} from "../store/screenStore";
import {
  jobStore,
} from "../store/jobStore";
import { emitJobEvent } from "../store/eventBus";
import { jobCancellation } from "../store/jobCancellation";
import { env } from "../../config/env";

export async function runDiscoveryJob(
  jobId: string,
  extraUrls: string[] = []
): Promise<void> {
  jobStore.update(jobId, {
    status: "running",
    progress: { current: 0, total: 0, message: "Tarayıcı başlatılıyor..." },
  });

  emitJobEvent(jobId, {
    type: "progress",
    message: "Tarayıcı başlatılıyor...",
  });

  const session = new BrowserSession();

  try {
    await session.launch();

    emitJobEvent(jobId, {
      type: "progress",
      message: "Giriş yapılıyor...",
    });

    await session.login();

    const page = session.getPage();

    emitJobEvent(jobId, {
      type: "progress",
      message: "Ekranlar keşfediliyor...",
    });

    const discoveredScreens = await discoverScreens(page);

    emitJobEvent(jobId, {
      type: "progress",
      message: `Otomatik tarama: ${discoveredScreens.length} ekran bulundu`,
    });

    if (discoveredScreens.length === 0 && extraUrls.length === 0) {
      emitJobEvent(jobId, {
        type: "progress",
        message: "Uyarı: Otomatik tarama sıfır link buldu. Login başarısız olmuş olabilir veya sayfa sidebar/nav yapısı tanınmıyor. Aşağıdaki 'Ek URL Ekle' alanından sayfa URL'lerini manuel ekleyebilirsiniz.",
      });
    }

    // Add manually provided extra URLs
    for (const url of extraUrls) {
      if (jobCancellation.isCancelled(jobId)) break;
      const alreadyFound = discoveredScreens.some(
        (s) => s.url === url
      );

      if (!alreadyFound) {
        emitJobEvent(jobId, {
          type: "progress",
          message: `Manuel URL ziyaret ediliyor: ${url}`,
        });

        try {
          const parsed = new URL(url);

          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          });

          await page.waitForTimeout(2000);

          const title = await page.title();
          const { screenshotPath, screenshotBase64 } =
            await captureScreenshot(page, parsed.pathname);

          discoveredScreens.push({
            url,
            path: parsed.pathname,
            title,
            screenshotPath,
            screenshotBase64,
            depth: 0,
          });
        } catch (err) {
          emitJobEvent(jobId, {
            type: "error",
            message: `Manuel URL ziyaret edilemedi: ${url} — ${(err as Error).message}`,
          });
        }
      }
    }

    const stored: StoredScreen[] = discoveredScreens.map((s) => ({
      url: s.url,
      path: s.path,
      title: s.title,
      screenshotPath: s.screenshotPath,
      depth: s.depth,
      ...(s.parentPath !== undefined
        ? { parentPath: s.parentPath }
        : {}),
      discoveredAt: new Date().toISOString(),
    }));

    screenStore.saveMany(stored);

    for (const screen of discoveredScreens) {
      emitJobEvent(jobId, {
        type: "screen",
        message: screen.title,
        data: {
          path: screen.path,
          title: screen.title,
          screenshotPath: screen.screenshotPath,
        },
      });
    }

    jobStore.update(jobId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      progress: {
        current: discoveredScreens.length,
        total: discoveredScreens.length,
        message: `${discoveredScreens.length} ekran keşfedildi`,
      },
    });

    emitJobEvent(jobId, {
      type: "complete",
      message: `${discoveredScreens.length} ekran keşfedildi`,
      data: { count: discoveredScreens.length },
    });
  } catch (err) {
    const message = (err as Error).message;

    jobStore.update(jobId, {
      status: "failed",
      error: message,
    });

    emitJobEvent(jobId, {
      type: "error",
      message,
    });

    throw err;
  } finally {
    await session.close();
  }
}
