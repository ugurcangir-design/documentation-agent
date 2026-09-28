import {
  chromium,
  Browser,
  BrowserContext,
  Page,
} from "playwright";

import { env } from "../config/env";

// Global registry of live browsers so signal handlers can close them.
const activeBrowsers = new Set<Browser>();
let signalHandlersInstalled = false;

function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const cleanup = async (signal: string) => {
    console.log(`[browser] ${signal} alındı — ${activeBrowsers.size} aktif tarayıcı kapatılıyor`);
    const closes = Array.from(activeBrowsers).map((b) =>
      b.close().catch(() => {})
    );
    await Promise.race([
      Promise.all(closes),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    process.exit(0);
  };

  process.on("SIGTERM", () => void cleanup("SIGTERM"));
  process.on("SIGINT",  () => void cleanup("SIGINT"));
  process.on("exit",    () => {
    // Synchronous best-effort — can't await here
    for (const b of activeBrowsers) {
      try { void b.close(); } catch { /* noop */ }
    }
  });
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch(): Promise<void> {
    installSignalHandlers();
    this.browser = await chromium.launch({ headless: true });
    activeBrowsers.add(this.browser);

    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });

    this.page = await this.context.newPage();
  }

  async login(): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    if (!env.appBaseUrl) throw new Error("APP_BASE_URL is not configured");
    if (!env.appUsername) throw new Error("APP_USERNAME is not configured");
    if (!env.appPassword) throw new Error("APP_PASSWORD is not configured");

    console.log(`  Navigating to: ${env.appBaseUrl}`);

    // Try domcontentloaded; if it fails, retry with 'commit' (just URL change)
    let navigated = false;
    try {
      await this.page.goto(env.appBaseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      navigated = true;
    } catch (err) {
      console.warn(`  goto warning: ${(err as Error).message.split("\n")[0]}`);
      try {
        await this.page.goto(env.appBaseUrl, {
          waitUntil: "commit",
          timeout: 20000,
        });
        navigated = true;
      } catch (err2) {
        console.warn(`  goto retry failed: ${(err2 as Error).message.split("\n")[0]}`);
      }
    }

    // Let the SPA boot
    await this.page.waitForTimeout(3000);

    let currentUrl = this.page.url();
    console.log(`  After initial nav (navigated=${navigated}), URL: ${currentUrl}`);

    if (currentUrl.startsWith("chrome-error://") || currentUrl === "about:blank") {
      throw new Error(
        `Sayfa yüklenemedi (${currentUrl}). SSL, DNS veya ağ sorunu olabilir. ` +
          `Tarayıcıdan ${env.appBaseUrl} açılabiliyor mu kontrol edin.`
      );
    }

    // Wait for either a password input OR a clear post-auth signal
    await this.page
      .waitForSelector(
        'input[type="password"], input[name="password"], nav a, aside a, [role="navigation"] a, [role="main"]',
        { state: "visible", timeout: 20000 }
      )
      .catch(() => {});

    // Decide whether we are on a login page or already authenticated
    currentUrl = this.page.url();
    const onLoginPage =
      /\/(login|signin|auth|account\/login)\b/i.test(currentUrl) ||
      (await this.page.$('input[type="password"]')) !== null;

    if (!onLoginPage) {
      console.log("  Hâlihazırda authenticated — login form yok");
      if (!currentUrl.startsWith(env.appBaseUrl)) {
        console.log(`  Hedefe navigate ediliyor: ${env.appBaseUrl}`);
        try {
          await this.page.goto(env.appBaseUrl, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          });
          await this.page.waitForTimeout(2000);
        } catch (err) {
          console.warn(`  target nav warning: ${(err as Error).message.split("\n")[0]}`);
        }
      }
      return;
    }

    console.log(`  Login sayfası tespit edildi (URL: ${currentUrl}), giriş yapılıyor`);

    const usernameSelectors = [
      'input[name="username"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[id="username"]',
      'input[id="email"]',
      'input[autocomplete="username"]',
      'input[placeholder*="kullanıcı" i]',
      'input[placeholder*="username" i]',
      'input[placeholder*="email" i]',
      'input[placeholder*="e-posta" i]',
      'input[type="text"]:first-of-type',
    ];

    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[id="password"]',
      'input[autocomplete="current-password"]',
    ];

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Giriş")',
      'button:has-text("Giriş Yap")',
      'button:has-text("Login")',
      'button:has-text("Sign In")',
      'button:has-text("Oturum Aç")',
      'input[type="submit"]',
    ];

    let usernameSel = "";
    for (const sel of usernameSelectors) {
      if (await this.page.$(sel)) {
        await this.fillField(sel, env.appUsername);
        usernameSel = sel;
        console.log(`  Kullanıcı adı dolduruldu: ${sel}`);
        break;
      }
    }
    if (!usernameSel) {
      throw new Error(
        "Kullanıcı adı / e-posta alanı bulunamadı. APP_BASE_URL'in login sayfasına yönlendirdiğinden emin olun."
      );
    }

    let passwordSel = "";
    for (const sel of passwordSelectors) {
      if (await this.page.$(sel)) {
        await this.fillField(sel, env.appPassword);
        passwordSel = sel;
        console.log(`  Şifre dolduruldu: ${sel}`);
        break;
      }
    }
    if (!passwordSel) {
      throw new Error("Şifre alanı bulunamadı.");
    }

    let submitSel = "";
    for (const sel of submitSelectors) {
      if (await this.page.$(sel)) { submitSel = sel; break; }
    }
    if (submitSel) {
      // React formlarında submit butonu alanlar geçerli olana dek `disabled`
      // olabilir; fillField blur ile doğrulamayı tetikledi, yine de aktifleşmeyi
      // kısa süre bekle (aksi halde disabled butona tıklama sessizce yutulur).
      await this.page
        .waitForFunction(
          (s) => { const b = document.querySelector(s) as HTMLButtonElement | null; return !!b && !b.disabled; },
          submitSel,
          { timeout: 4000 }
        )
        .catch(() => {});
      await this.page.click(submitSel, { timeout: 5000 }).catch(() => {});
      console.log(`  Submit tıklandı: ${submitSel}`);
    } else {
      // Last resort: press Enter
      await this.page.press(passwordSel, "Enter").catch(() => {});
      console.log("  Enter ile submit denendi");
    }

    // Wait for the password input to disappear or URL to change
    const startUrl = currentUrl;
    try {
      await Promise.race([
        this.page.waitForFunction(
          () => !document.querySelector('input[type="password"]'),
          { timeout: 20000 }
        ),
        this.page.waitForURL((u) => u.toString() !== startUrl, { timeout: 20000 }),
      ]);
    } catch {
      console.warn("  Post-login sinyal 20s içinde gelmedi");
    }
    await this.page.waitForTimeout(2000);

    const afterLoginUrl = this.page.url();
    console.log(`  Login sonrası URL: ${afterLoginUrl}`);

    if (/\/(login|signin|auth)\b/i.test(afterLoginUrl)) {
      // Still on login → likely invalid creds, MFA/OTP step, or locked account.
      // Sayfadaki GERÇEK hata mesajını oku → kullanıcı nedeni anında görsün
      // (yanlış şifre / MFA / hesap kilitli vb.), tahmin etmesin.
      const pageErr = await this.extractVisibleError();
      if (pageErr) console.warn(`  Login sayfası hata mesajı: ${pageErr}`);
      throw new Error(
        `Login başarısız görünüyor — hâlâ login sayfasındayız (${afterLoginUrl}).` +
          (pageErr
            ? ` Uygulamanın verdiği mesaj: "${pageErr}". `
            : " Sayfada görünür bir hata mesajı yok. ") +
          "Ayarlar'dan APP_USERNAME/APP_PASSWORD'ü kontrol edin; ek doğrulama (MFA/OTP) varsa bu akış desteklemez."
      );
    }

    // Navigate back to target if we were redirected elsewhere
    if (!afterLoginUrl.startsWith(env.appBaseUrl)) {
      console.log(`  Hedefe geri dön: ${env.appBaseUrl}`);
      try {
        await this.page.goto(env.appBaseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });
        await this.page.waitForTimeout(2500);
      } catch (err) {
        console.warn(`  target nav warning: ${(err as Error).message.split("\n")[0]}`);
      }
    }
  }

  /**
   * React/SPA login formlarına dayanıklı alan doldurma. `fill` çoğu React
   * formunda çalışır (value + input event → onChange), ama bazı formlar
   * (react-hook-form register, blur-doğrulaması) alanı "dokunulmadı" sayıp
   * submit'i engelleyebilir. Bu yüzden: fill → değeri DOĞRULA → tutmadıysa
   * gerçek tuş girişiyle (pressSequentially) tekrar dene → blur ile doğrulamayı
   * tetikle. Şifre değeri koda `env`'den gelir; burada asla loglanmaz.
   */
  private async fillField(sel: string, value: string): Promise<void> {
    if (!this.page) return;
    const loc = this.page.locator(sel).first();
    await loc.click({ timeout: 5000 }).catch(() => {});
    await loc.fill(value, { timeout: 5000 }).catch(() => {});
    // Değer gerçekten girildi mi? (kontrollü input reset etmiş olabilir)
    const stuck = await loc.inputValue().catch(() => "");
    if (stuck !== value) {
      await loc.fill("", { timeout: 3000 }).catch(() => {});
      await loc.pressSequentially(value, { delay: 20, timeout: 8000 }).catch(() => {});
    }
    await loc.blur().catch(() => {});
  }

  /** Login sayfasındaki görünür hata/uyarı metnini en-iyi-çaba ile okur
   *  (yanlış kimlik, MFA, kilitli hesap vb.). Bulunamazsa boş döner. */
  private async extractVisibleError(): Promise<string> {
    if (!this.page) return "";
    const selectors = [
      '[role="alert"]',
      '[aria-live="assertive"]',
      '[aria-live="polite"]',
      ".error", ".error-message", ".invalid-feedback", ".field-error",
      ".text-red-500", ".text-danger", ".text-error",
      ".ant-message-error", ".ant-form-item-explain-error",
      ".Toastify__toast--error", ".toast-error", ".MuiAlert-message",
    ];
    for (const sel of selectors) {
      try {
        const el = await this.page.$(sel);
        if (!el) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        const txt = ((await el.innerText().catch(() => "")) || "").trim();
        if (txt) return txt.replace(/\s+/g, " ").slice(0, 200);
      } catch { /* devam */ }
    }
    return "";
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched");
    return this.page;
  }

  async close(): Promise<void> {
    if (this.browser) activeBrowsers.delete(this.browser);
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
