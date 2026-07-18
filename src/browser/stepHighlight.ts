/**
 * Adım vurgusu (Scribe/Tango deseni): bir öğe TIKLANMADAN hemen önce
 * etrafına kırmızı yuvarlatılmış çerçeve + "adım" rozeti çizilir ve o anın
 * ekran görüntüsü yakalanır → kılavuz "X butonuna tıklayın" derken butonun
 * ekranda NEREDE olduğunu gösteren bir görsel de sunar (okuyucu aramaz).
 *
 * Overlay DOM'a geçici olarak enjekte edilir (sayfanın kendi koduna
 * dokunulmaz) ve yakalamadan hemen sonra kaldırılır — sonraki gerçek
 * tıklama/yakalamalar etkilenmez. Her adımda en-iyi-çaba: overlay veya
 * yakalama başarısız olursa keşif akışı AYNEN devam eder (fatal değil).
 *
 * ANNOTATE_STEPS=false ile kapatılabilir (varsayılan açık).
 */

import type { Page, Locator } from "playwright";
import { env } from "../config/env";

const OVERLAY_ID = "__docagent_step_highlight__";

type PushFn = (
  label: string,
  triggeredBy: string,
  filename: string
) => Promise<void>;

/** Hedef öğenin üzerine vurgu çizer, viewport görüntüsünü push eder,
 *  overlay'i kaldırır. Hata durumunda sessizce geçer (keşif durmaz). */
export async function captureStepHighlight(
  page: Page,
  target: Locator,
  actionLabel: string,
  filename: string,
  push: PushFn
): Promise<void> {
  if (!env.annotateSteps) return;
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
    const box = await target.boundingBox();
    if (!box || box.width < 2 || box.height < 2) return;

    await page.evaluate(
      ({ id, x, y, w, h }) => {
        document.getElementById(id)?.remove();
        const pad = 4;
        const wrap = document.createElement("div");
        wrap.id = id;
        // Belge koordinatına sabitle (viewport scroll'dan bağımsız).
        wrap.style.cssText = [
          "position:absolute",
          `left:${x + window.scrollX - pad}px`,
          `top:${y + window.scrollY - pad}px`,
          `width:${w + pad * 2}px`,
          `height:${h + pad * 2}px`,
          "border:3px solid #e11d48",
          "border-radius:8px",
          "box-shadow:0 0 0 3px rgba(225,29,72,.25)",
          "pointer-events:none",
          "z-index:2147483647",
        ].join(";");
        const badge = document.createElement("div");
        badge.textContent = "➜";
        badge.style.cssText = [
          "position:absolute",
          "top:-12px",
          "left:-12px",
          "width:24px",
          "height:24px",
          "border-radius:50%",
          "background:#e11d48",
          "color:#fff",
          "font:bold 13px/24px sans-serif",
          "text-align:center",
          "pointer-events:none",
        ].join(";");
        wrap.appendChild(badge);
        document.body.appendChild(wrap);
      },
      { id: OVERLAY_ID, x: box.x, y: box.y, w: box.width, h: box.height }
    );

    // Viewport yakalama (öğe scrollIntoView ile görünür alanda).
    await push(
      `Adım: "${actionLabel}" (konumu işaretli)`,
      "adım vurgusu — tıklanacak öğe kırmızı çerçeveyle gösterildi",
      filename
    );
  } catch {
    // en-iyi-çaba — vurgu başarısızsa keşif normal devam eder
  } finally {
    await page
      .evaluate((id) => document.getElementById(id)?.remove(), OVERLAY_ID)
      .catch(() => {});
  }
}
