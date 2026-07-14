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

  // Coverage doğrulama: substring match "label gövdede geçti" der ama
  // "açıklandı" garanti etmez. Haiku ile "anlamlı şekilde anlatıldı mı?"
  // yargısı yapar; sahte coverage'ı düşürür → fix-up daha iyi hedeflenir.
  // Hata olursa graceful fallback (raw substring coverage); kalite düşmez.
  // Kapatmak için: COVERAGE_LLM_JUDGE=false
  get coverageLlmJudge(): boolean {
    return (process.env.COVERAGE_LLM_JUDGE || "true").toLowerCase() !== "false";
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

  // İnteraktif keşifte açılan form/modal alanlarına güvenli test verisi
  // doldur (asla submit etmez) — "dolu form" state'i yakalanır, kılavuz
  // adım-adım veri girişini anlatabilir. Yan etkiden çekinen kullanıcı
  // FILL_TEST_DATA=false ile kapatabilir.
  get fillTestData(): boolean {
    return (process.env.FILL_TEST_DATA || "true").toLowerCase() !== "false";
  },

  // ⚠️ GERÇEK MUTASYON: açıkken keşif, doldurduğu form/modal'da Kaydet/
  // Gönder/Oluştur gibi YAZMA butonlarını gerçekten tıklar → hedef
  // uygulamada GERÇEK KAYIT oluşur/güncellenir. Kayıt-sonrası başarı
  // ekranını belgelemek için. VARSAYILAN KAPALI — yalnız test/staging
  // ortamında ALLOW_FORM_SUBMIT=true yapın. Okuma submit'leri (Ara/
  // Filtrele) bu bayraktan bağımsız, her zaman güvenle çalıştırılır.
  get allowFormSubmit(): boolean {
    return (process.env.ALLOW_FORM_SUBMIT || "false").toLowerCase() === "true";
  },

  // Derin keşif: ekrandaki HER sekme için, o sekmenin içindeki butonları/
  // modalları/formları/mesajları ayrı ayrı simüle eder (gerçek kullanıcı
  // gibi tüm akışları gezer). Kapsamlı kılavuz için varsayılan AÇIK; çok
  // sekmeli ekranlarda keşif süresi/maliyeti artar → DEEP_EXPLORE=false
  // ile kapatılabilir (yalnız aktif sekme derinlemesine gezilir).
  get deepExplore(): boolean {
    return (process.env.DEEP_EXPLORE || "true").toLowerCase() !== "false";
  },

  // Canlı uygulama kanıtı: ekran başına Claude'a gerçek tarayıcıyı MCP
  // (@playwright/mcp) üzerinden sürdürüp DOM + network (CRUD) gözlemi
  // topluyor, userManual üretimine ek kanıt olarak besliyor. Yalnız CLI
  // backend'de çalışır (bkz. claudeClient.ts). Claude'un kendisinin
  // tıklaması gerektiğinden ekran başına onlarca ek tool-call turu —
  // varsayılan KAPALI, isteyen LIVE_APP_MCP_ENABLED=true ile açar.
  get liveAppMcpEnabled(): boolean {
    return (process.env.LIVE_APP_MCP_ENABLED || "false").toLowerCase() === "true";
  },
  // Gezinme sabit analiz çağrısından (360s) daha uzun sürebilir — varsayılan 8dk.
  get liveAppMcpTimeoutMs(): number {
    const n = parseInt(process.env.LIVE_APP_MCP_TIMEOUT_MS || "480000", 10);
    return Number.isFinite(n) && n > 0 ? n : 480000;
  },
};
