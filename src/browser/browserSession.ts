import {
  chromium,
  Browser,
  BrowserContext,
  Page,
} from "playwright";

import { env } from "../config/env";

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async launch(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });

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
      const exists = await this.page.$(sel);
      if (exists) {
        await this.page.fill(sel, env.appUsername, { timeout: 5000 }).catch(() => {});
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
        await this.page.fill(sel, env.appPassword, { timeout: 5000 }).catch(() => {});
        passwordSel = sel;
        console.log(`  Şifre dolduruldu: ${sel}`);
        break;
      }
    }
    if (!passwordSel) {
      throw new Error("Şifre alanı bulunamadı.");
    }

    let submitted = false;
    for (const sel of submitSelectors) {
      if (await this.page.$(sel)) {
        await this.page.click(sel, { timeout: 5000 }).catch(() => {});
        console.log(`  Submit tıklandı: ${sel}`);
        submitted = true;
        break;
      }
    }
    if (!submitted) {
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
      // Still on login → likely invalid creds or extra MFA
      throw new Error(
        `Login başarısız görünüyor — hâlâ login sayfasındayız (${afterLoginUrl}). Kullanıcı adı/şifreyi kontrol edin.`
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

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched");
    return this.page;
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
