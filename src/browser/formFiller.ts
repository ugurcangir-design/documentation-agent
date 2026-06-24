/**
 * Safe automatic test-data filler. Simulates a user entering realistic
 * Turkish sample data into a form so the captured "filled" state — and
 * thus the generated user manual — can describe the real data-entry flow,
 * field formats and validation, not just an empty form.
 *
 * GÜVENLİK SÖZLEŞMESİ:
 *  - ASLA submit / kaydet / gönder / sil tetiklemez. Yalnızca alanları
 *    doldurur; form gönderimi yapılmaz.
 *  - Parola alanları doldurulmaz (gizlilik + yanlışlıkla kayıt riski).
 *  - file input doldurulmaz.
 *  - Hedef uygulamadan bağımsız çalışır: tür (input type) + alan adı/etiket
 *    sezgisiyle anlamlı değer seçer.
 */

import type { Page, Locator } from "playwright";

export interface FieldMeta {
  /** input type attribute (lower-case), ya da 'textarea' / 'select'. */
  type: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
}

/** YYYY-MM-DD (date input value formatı). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoWeek(d: Date): string {
  // ISO 8601 week number
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Bir form alanı için anlamlı Türkçe örnek değer üretir. Tür önceliklidir;
 * serbest metin alanlarında ad/etiket/placeholder anahtar kelimeleriyle
 * bağlama uygun değer seçilir. `null` → alan doldurulmamalı (örn. parola).
 *
 * Saf fonksiyon (yan etkisiz, deterministik) — `now` enjekte edilebilir.
 */
export function sampleValueForField(meta: FieldMeta, now: Date = new Date()): string | null {
  const type = (meta.type || "text").toLowerCase();
  const hay = [meta.name, meta.id, meta.label, meta.placeholder]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr");

  const has = (...ks: string[]) => ks.some((k) => hay.includes(k));

  // Tür-öncelikli kararlar
  switch (type) {
    case "password":
      return null; // güvenlik: parola doldurma
    case "file":
      return null;
    case "email":
      return "test@ornek.com";
    case "tel":
      return "5321234567";
    case "url":
      return "https://ornek.com";
    case "number":
    case "range":
      return "42";
    case "date":
      return isoDate(now);
    case "datetime-local":
      return `${isoDate(now)}T10:00`;
    case "month":
      return isoDate(now).slice(0, 7);
    case "week":
      return isoWeek(now);
    case "time":
      return "10:00";
    case "color":
      return "#2dd4bf";
  }

  // Serbest metin (text / search / textarea / type'sız) — bağlama göre
  if (has("e-posta", "eposta", "email", "e-mail", "mail")) return "test@ornek.com";
  if (has("telefon", "phone", "gsm", "cep", "tel")) return "5321234567";
  if (has("iban")) return "TR000000000000000000000000";
  if (has("tckn", "kimlik", "vergi", "vkn")) return "11111111111";
  if (has("tutar", "fiyat", "price", "amount", "miktar", "adet", "stok", "bakiye", "ücret", "ucret")) return "100";
  if (has("yüzde", "yuzde", "oran", "percent")) return "10";
  if (has("url", "website", "web sitesi", "site", "link")) return "https://ornek.com";
  if (has("açıklama", "aciklama", "description", "not", "note", "yorum", "comment", "mesaj", "message", "detay")) {
    return "Örnek açıklama metni — test amaçlı doldurulmuştur.";
  }
  if (has("adres", "address")) return "Örnek Mah. Test Cad. No:1 Çankaya/Ankara";
  if (has("şehir", "sehir", "city", "il")) return "Ankara";
  if (has("ülke", "ulke", "country")) return "Türkiye";
  if (has("posta kod", "zip", "postal")) return "06000";
  if (has("kod", "code", "numara", "no", "barkod", "sku", "referans")) return "ORN-123";
  if (has("ad soyad", "adı soyadı", "full name", "fullname")) return "Örnek Kullanıcı";
  if (has("soyad", "surname", "lastname")) return "Örnek";
  if (has("kullanıcı", "kullanici", "username", "user")) return "ornek.kullanici";
  if (has("ad", "isim", "name", "unvan", "ünvan", "title", "başlık", "baslik", "firma", "şirket", "sirket")) {
    return "Örnek Ad";
  }
  if (has("ara", "search", "filtre", "filter", "sorgu", "query")) return "örnek";

  return "Örnek Veri";
}

/** Doldurma sonucu özeti. */
export interface FillResult {
  filledCount: number;
  /** Doldurulan alanların kısa etiketleri (log + state açıklaması için). */
  labels: string[];
}

const FILL_TIMEOUT = 2000;
const CLICK_TIMEOUT = 2500;

// ── Submit butonu sınıflandırma ──────────────────────────────────────
export type SubmitKind = "read" | "write" | "destructive" | "none";

// Okuma (mutasyonsuz, güvenle çalıştırılabilir) — filtre/arama/listele.
const READ_SUBMIT_RE =
  /\b(ara|arama|filtrele|filtre\s*uygula|uygula|listele|getir|sorgula|göster|goster|yenile|search|filter|apply|list|query|show|refresh)\b/i;
// Yazma (mutasyon yapar) — yalnız ALLOW_FORM_SUBMIT açıkken tıklanır.
const WRITE_SUBMIT_RE =
  /\b(kaydet|kayıt\s*et|kaydı\s*tamamla|gönder|gonder|oluştur|olustur|ekle|güncelle|guncelle|onayla|tamamla|save|submit|create|update|confirm|send)\b/i;
// Yıkıcı — asla tıklanmaz.
const SUBMIT_DESTRUCTIVE_RE = /\b(sil|kaldır|kaldir|delete|remove)\b/i;

/**
 * Bir buton etiketini submit niyetine göre sınıflandırır. Okuma >
 * yazma önceliklidir ("filtre uygula" → read). Saf fonksiyon, test'li.
 */
export function classifySubmitButton(label: string): SubmitKind {
  const l = (label || "").toLocaleLowerCase("tr").trim();
  if (!l) return "none";
  if (SUBMIT_DESTRUCTIVE_RE.test(l)) return "destructive";
  if (READ_SUBMIT_RE.test(l)) return "read";
  if (WRITE_SUBMIT_RE.test(l)) return "write";
  return "none";
}

/** Bir alanın anlamlı etiketini DOM'dan türetir (aria-label / label[for] /
 *  placeholder / name). En iyi-çaba; başarısızsa boş döner. */
async function fieldMetaOf(loc: Locator): Promise<FieldMeta> {
  try {
    return await loc.evaluate((el: Element) => {
      const e = el as HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement;
      const tag = e.tagName.toLowerCase();
      const type = tag === "select" ? "select" : tag === "textarea" ? "textarea" : (e.getAttribute("type") || "text");
      let label = e.getAttribute("aria-label") || "";
      if (!label && e.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
        if (lbl) label = (lbl.textContent || "").trim();
      }
      if (!label) {
        const wrap = e.closest("label");
        if (wrap) label = (wrap.textContent || "").trim();
      }
      return {
        type: type.toLowerCase(),
        name: e.getAttribute("name") || "",
        id: e.id || "",
        label: label.slice(0, 60),
        placeholder: e.getAttribute("placeholder") || "",
      };
    });
  } catch {
    return { type: "text" };
  }
}

/**
 * `scope` (bir modal/panel Locator'ı ya da `page`) içindeki görünür,
 * etkin form alanlarını güvenli test verisiyle doldurur. Submit ETMEZ.
 * Doldurulan alan sayısı + etiketlerini döndürür.
 */
export async function fillTestData(
  page: Page,
  scope: Page | Locator,
  log: (m: string) => void,
  maxFields = 15
): Promise<FillResult> {
  const labels: string[] = [];
  let filled = 0;

  const root = "locator" in scope ? (scope as Locator) : (scope as Page);

  // 1. Metin benzeri inputlar + textarea
  const textSel =
    'input[type="text"]:not([disabled]):not([readonly]), ' +
    'input[type="search"]:not([disabled]):not([readonly]), ' +
    'input[type="email"]:not([disabled]):not([readonly]), ' +
    'input[type="number"]:not([disabled]):not([readonly]), ' +
    'input[type="tel"]:not([disabled]):not([readonly]), ' +
    'input[type="url"]:not([disabled]):not([readonly]), ' +
    'input[type="date"]:not([disabled]):not([readonly]), ' +
    'input[type="datetime-local"]:not([disabled]):not([readonly]), ' +
    'input[type="month"]:not([disabled]):not([readonly]), ' +
    'input[type="time"]:not([disabled]):not([readonly]), ' +
    'input:not([type]):not([disabled]):not([readonly]), ' +
    'textarea:not([disabled]):not([readonly])';

  const textInputs = root.locator(textSel);
  const tCount = await textInputs.count().catch(() => 0);
  for (let i = 0; i < tCount && filled < maxFields; i++) {
    const loc = textInputs.nth(i);
    try {
      if (!(await loc.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const existing = await loc.inputValue().catch(() => "");
      if (existing && existing.trim().length > 0) continue; // mevcut değeri koru
      const meta = await fieldMetaOf(loc);
      const value = sampleValueForField(meta);
      if (value === null) continue; // parola/file → atla
      await loc.fill(value, { timeout: FILL_TIMEOUT });
      filled++;
      labels.push(meta.label || meta.placeholder || meta.name || meta.type);
    } catch {
      /* alanı atla */
    }
  }

  // 2. Select / dropdown — ilk anlamlı (boş olmayan) seçeneği seç
  const selects = root.locator('select:not([disabled])');
  const sCount = await selects.count().catch(() => 0);
  for (let i = 0; i < sCount && filled < maxFields; i++) {
    const loc = selects.nth(i);
    try {
      if (!(await loc.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const picked = await loc.evaluate((el: HTMLSelectElement) => {
        for (let o = 0; o < el.options.length; o++) {
          const opt = el.options[o];
          if (opt && opt.value && !opt.disabled) return opt.value;
        }
        return "";
      });
      if (!picked) continue;
      await loc.selectOption(picked, { timeout: FILL_TIMEOUT });
      filled++;
      const meta = await fieldMetaOf(loc);
      labels.push(meta.label || meta.name || "seçim");
    } catch {
      /* atla */
    }
  }

  // 3. Checkbox / radio — ilk işaretsiz olanı işaretle (her grup için bir)
  const checks = root.locator(
    'input[type="checkbox"]:not([disabled]):not([readonly]), input[type="radio"]:not([disabled]):not([readonly])'
  );
  const cCount = await checks.count().catch(() => 0);
  const seenRadioGroups = new Set<string>();
  for (let i = 0; i < cCount && filled < maxFields; i++) {
    const loc = checks.nth(i);
    try {
      if (!(await loc.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const meta = await fieldMetaOf(loc);
      if (meta.type === "radio") {
        const grp = meta.name || `__r${i}`;
        if (seenRadioGroups.has(grp)) continue;
        seenRadioGroups.add(grp);
      }
      if (await loc.isChecked().catch(() => false)) continue;
      await loc.check({ timeout: FILL_TIMEOUT, force: true });
      filled++;
      labels.push(meta.label || meta.name || meta.type);
    } catch {
      /* atla */
    }
  }

  if (filled > 0) {
    log(`  ↳ ${filled} alan test verisiyle dolduruldu: ${labels.slice(0, 6).join(", ")}${labels.length > 6 ? "…" : ""}`);
  }
  return { filledCount: filled, labels };
}

/**
 * Katman A — istemci-tarafı doğrulama uyarısını TETİKLER (mutasyonsuz).
 * İlk zorunlu/e-posta alanını kasıtlı geçersiz yapıp odaktan çıkarır
 * (blur); çoğu form (RHF/Formik/AntD/MUI) inline hata gösterir. Hata
 * öğesi tespit edilirse `true` döner. Sunucuya hiçbir istek gitmez.
 */
export async function triggerValidation(
  page: Page,
  scope: Page | Locator,
  log: (m: string) => void
): Promise<boolean> {
  const root = "locator" in scope ? (scope as Locator) : (scope as Page);
  try {
    const target = root
      .locator(
        'input[required]:not([disabled]):not([readonly]), ' +
        'input[aria-required="true"]:not([disabled]):not([readonly]), ' +
        'input[type="email"]:not([disabled]):not([readonly])'
      )
      .first();
    if ((await target.count().catch(() => 0)) === 0) return false;
    if (!(await target.isVisible({ timeout: 400 }).catch(() => false))) return false;

    const type = (await target.getAttribute("type").catch(() => "")) || "";
    if (type === "email") {
      await target.fill("gecersiz-eposta", { timeout: FILL_TIMEOUT });
    } else {
      await target.fill("", { timeout: FILL_TIMEOUT }); // zorunlu alanı boşalt
    }
    await target.blur().catch(() => {});
    await page.keyboard.press("Tab").catch(() => {});
    await page.waitForTimeout(500);

    const err = root.locator(
      '[role="alert"], [aria-invalid="true"], ' +
      '[class*="error" i]:not([class*="boundary" i]), [class*="invalid" i], ' +
      '.ant-form-item-explain-error, .Mui-error, [class*="ErrorMessage"]'
    );
    let visibleErr = false;
    const ec = await err.count().catch(() => 0);
    for (let i = 0; i < Math.min(ec, 5); i++) {
      if (await err.nth(i).isVisible({ timeout: 200 }).catch(() => false)) { visibleErr = true; break; }
    }
    if (visibleErr) log(`  ↳ doğrulama uyarısı tetiklendi (geçersiz/boş zorunlu alan)`);
    return visibleErr;
  } catch {
    return false;
  }
}

/**
 * `scope` içinde verilen `kind`'a (read|write) uyan İLK submit butonunu
 * bulup tıklar. Yıkıcı (sil/delete) butonlar asla tıklanmaz. Okuma
 * butonları (Ara/Filtrele) mutasyonsuzdur; yazma butonları (Kaydet/Gönder)
 * gerçek mutasyon yapar — çağıran yalnızca ALLOW_FORM_SUBMIT açıkken
 * 'write' ile çağırmalıdır. Tıklanan butonun etiketini döndürür.
 */
export async function clickSubmitButton(
  page: Page,
  scope: Page | Locator,
  kind: "read" | "write",
  log: (m: string) => void
): Promise<{ clicked: boolean; label: string }> {
  const root = "locator" in scope ? (scope as Locator) : (scope as Page);
  const btns = root.locator(
    'button:not([disabled]), button[type="submit"]:not([disabled]), ' +
    'input[type="submit"]:not([disabled]), [role="button"]:not([aria-disabled="true"])'
  );
  const n = await btns.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    try {
      if (!(await b.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const raw =
        (await b.textContent().catch(() => "")) ||
        (await b.getAttribute("value").catch(() => "")) ||
        (await b.getAttribute("aria-label").catch(() => "")) ||
        "";
      const label = raw.trim().replace(/\s+/g, " ").slice(0, 40);
      if (classifySubmitButton(label) !== kind) continue;

      await b.click({ timeout: CLICK_TIMEOUT }).catch(async () => {
        await b.click({ timeout: CLICK_TIMEOUT, force: true });
      });
      log(`  ↳ ${kind === "read" ? "okuma" : "YAZMA"} submit tıklandı: ${label}`);
      return { clicked: true, label };
    } catch {
      /* sonraki buton */
    }
  }
  return { clicked: false, label: "" };
}
