import "dotenv/config";

// Lazy getters → every read picks up the current process.env, so
// updates saved through the Settings UI take effect immediately
// (no server restart needed).
export const env = {
  get anthropicApiKey() { return process.env.ANTHROPIC_API_KEY || ""; },

  get confluenceBaseUrl() { return process.env.CONFLUENCE_BASE_URL || ""; },
  get confluenceEmail() { return process.env.CONFLUENCE_EMAIL || ""; },
  get confluenceApiToken() { return process.env.CONFLUENCE_API_TOKEN || ""; },
  get confluenceSpaceKey() { return process.env.CONFLUENCE_SPACE_KEY || ""; },
  get confluenceParentPageId() { return process.env.CONFLUENCE_PARENT_PAGE_ID || ""; },

  get appBaseUrl() { return process.env.APP_BASE_URL || ""; },
  get appUsername() { return process.env.APP_USERNAME || ""; },
  get appPassword() { return process.env.APP_PASSWORD || ""; },

  get docLanguage() { return process.env.DOC_LANGUAGE || "tr"; },
  get maxDiscoveryDepth() { return parseInt(process.env.MAX_DISCOVERY_DEPTH || "2", 10); },

  // 'cli'  → shell out to `claude` (Claude Code CLI), uses local Claude Code auth
  // 'api'  → Anthropic SDK with ANTHROPIC_API_KEY
  get claudeBackend(): "cli" | "api" {
    return (process.env.CLAUDE_BACKEND as "cli" | "api") || "cli";
  },
  get claudeCliBin() { return process.env.CLAUDE_CLI_BIN || "claude"; },
};
