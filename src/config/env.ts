import "dotenv/config";

export const env = {
  confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL || "",
  confluenceEmail: process.env.CONFLUENCE_EMAIL || "",
  confluenceApiToken: process.env.CONFLUENCE_API_TOKEN || "",

  appBaseUrl: process.env.APP_BASE_URL || "",
  appUsername: process.env.APP_USERNAME || "",
  appPassword: process.env.APP_PASSWORD || "",
};