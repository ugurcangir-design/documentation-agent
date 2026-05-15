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
    });

    this.page = await this.context.newPage();
  }

  async login(): Promise<void> {
    if (!this.page) throw new Error("Browser not launched");
    if (!env.appBaseUrl) throw new Error("APP_BASE_URL is not configured");
    if (!env.appUsername) throw new Error("APP_USERNAME is not configured");
    if (!env.appPassword) throw new Error("APP_PASSWORD is not configured");

    console.log(`  Navigating to: ${env.appBaseUrl}`);

    await this.page.goto(env.appBaseUrl, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    const usernameSelectors = [
      'input[name="username"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[id="username"]',
      'input[id="email"]',
      'input[placeholder*="kullanıcı" i]',
      'input[placeholder*="username" i]',
      'input[placeholder*="email" i]',
    ];

    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[id="password"]',
    ];

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Giriş")',
      'button:has-text("Giriş Yap")',
      'button:has-text("Login")',
      'button:has-text("Sign In")',
      'input[type="submit"]',
    ];

    let foundUsername = false;

    for (const sel of usernameSelectors) {
      if (await this.page.$(sel)) {
        await this.page.fill(sel, env.appUsername);
        foundUsername = true;
        console.log(`  Filled username with selector: ${sel}`);
        break;
      }
    }

    if (!foundUsername) {
      throw new Error(
        "Could not find username/email input — verify APP_BASE_URL points to login page"
      );
    }

    for (const sel of passwordSelectors) {
      if (await this.page.$(sel)) {
        await this.page.fill(sel, env.appPassword);
        console.log(`  Filled password with selector: ${sel}`);
        break;
      }
    }

    for (const sel of submitSelectors) {
      if (await this.page.$(sel)) {
        await this.page.click(sel);
        console.log(`  Clicked submit with selector: ${sel}`);
        break;
      }
    }

    await this.page
      .waitForNavigation({
        waitUntil: "networkidle",
        timeout: 15000,
      })
      .catch(() => {});

    const currentUrl = this.page.url();
    console.log(`  Post-login URL: ${currentUrl}`);
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched");
    return this.page;
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
