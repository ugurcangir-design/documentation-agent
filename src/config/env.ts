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
  get maxDiscoveryDepth() { return parseInt(process.env.MAX_DISCOVERY_DEPTH || "0", 10); },

  // Coverage fix-up: üretilen doküman bu eşiğin altındaysa eksik UI
  // öğeleri için ek üretim turu tetiklenir. 0-100 arası; varsayılan 90.
  // Kullanıcı "%80 yetsin, hızlı bitsin" diyebilir; 100'e yaklaşınca
  // daha fazla LLM çağrısı + maliyet artar.
  get fixUpThreshold(): number {
    const n = parseInt(process.env.FIX_UP_THRESHOLD || "90", 10);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 90;
  },
  // Fix-up döngüsü kaç tur deneyebilir (varsayılan 2; her tur ekstra
  // LLM çağrısı demektir, eşik karşılanmadan önce vazgeç).
  get fixUpMaxPasses(): number {
    const n = parseInt(process.env.FIX_UP_MAX_PASSES || "2", 10);
    return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 2;
  },

  // Express server portu — tüm yerel URL'ler (OAuth redirect, frontend
  // fetch BASE, screenshots) bu değerden türer. Atlassian developer
  // konsoluna kayıtlı redirect URI'nin bu portla eşleşmesi gerektiğini
  // unutma — değiştirirsen Atlassian tarafında da güncelle.
  get port() { return parseInt(process.env.PORT || "3000", 10); },

  // 'cli'  → shell out to `claude` (Claude Code CLI), uses local Claude Code auth
  // 'api'  → Anthropic SDK with ANTHROPIC_API_KEY
  get claudeBackend(): "cli" | "api" {
    return (process.env.CLAUDE_BACKEND as "cli" | "api") || "cli";
  },
  get claudeCliBin() { return process.env.CLAUDE_CLI_BIN || "claude"; },
};
