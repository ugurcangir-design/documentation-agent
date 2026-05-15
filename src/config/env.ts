import "dotenv/config";

export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",

  confluenceBaseUrl: process.env.CONFLUENCE_BASE_URL || "",
  confluenceEmail: process.env.CONFLUENCE_EMAIL || "",
  confluenceApiToken: process.env.CONFLUENCE_API_TOKEN || "",
  confluenceSpaceKey: process.env.CONFLUENCE_SPACE_KEY || "",
  confluenceParentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID || "",

  appBaseUrl: process.env.APP_BASE_URL || "",
  appUsername: process.env.APP_USERNAME || "",
  appPassword: process.env.APP_PASSWORD || "",

  docLanguage: process.env.DOC_LANGUAGE || "tr",
  maxDiscoveryDepth: parseInt(process.env.MAX_DISCOVERY_DEPTH || "2", 10),
};