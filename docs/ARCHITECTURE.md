# documentation-agent — Claude Code Context

## Proje Özeti
Node.js + TypeScript. Express API **port 3000**, Vite client **port 5173**
(prod build aynı sunucudan). Yerel masaüstü uygulaması — bir tarayıcı sekmesi
açık olduğu sürece yaşar.

```
Hedef uygulama → Playwright ile ekran keşfi → BRD / Confluence / Jira / Swagger
referansları ile RAG bağlamı → Claude → Türkçe Kullanıcı Kılavuzu + Teknik Döküman
→ Confluence v2 API'sine yayım veya DOCX/MD/PDF/ZIP dışa aktarım
```

Başlat:
```
npm run dev               # server + vite paralel (concurrently)
# veya
npm run launcher          # macOS .app + supervisor
npm test                  # vitest birim testleri (tests/*.test.ts)
```

---

## Dosya Yapısı & Anahtar Fonksiyonlar

```
src/
  index.ts                       CLI giriş noktası (npm run cli)
  llm/claudeClient.ts            Claude SDK + CLI iki backend (270 satır)
  config/
    env.ts                       Lazy env okuyucu (Settings'ten anında güncellenir)
    promptConfig.ts              data/prompts/config.json'dan prompt cfg
  browser/
    browserSession.ts            Playwright Chromium oturumu + login
    screenDiscovery.ts           URL → ekran graph keşfi (ana ekran fullPage)
    interactiveExplorer.ts       Filtre/modal/satır-aksiyon etkileşimli yakalama
                                  + test-verisi doldurma + modal clip
    formFiller.ts                Güvenli otomatik test-verisi doldurma
                                  (sampleValueForField + fillTestData; ASLA submit)
    screenshotCapture.ts         PNG ekran görüntüsü (opts: fullPage | clip<modal>)
  analysis/
    screenAnalyzer.ts            Claude → screen analysis (UI öğeleri, akışlar)
    screenContextBuilder.ts      RAG → preparedChunks + paragraphMatches
  retrieval/
    brdSectionParser.ts          Markdown # heading'lerine göre böl
    flatTextSectionParser.ts     Heading'siz .docx/.pdf için sezgisel
                                  parser (numbered + ALL-CAPS) + dispatcher
    documentSearch.ts            Skor × kaynak önceliği sıralama
    paragraphSearch.ts           Paragraf düzeyinde uzun-kuyruk eşleşme
    endpointSearch.ts            API endpoint eşleştirme
    contextBudget.ts             Diversity-aware chunking + bütçe (chunkSection)
  ingestion/
    documentLoader.ts            data/brd/*.md okuyucu
    confluenceReader.ts          Legacy: env-tabanlı space tarama (v2 API)
    swaggerReader.ts             data/swagger/*.json
    swaggerParser.ts             OpenAPI → Endpoint[] çıkarımı
    sourceSync.ts                Yeni: space + Jira project senkronizasyonu
  quality/
    referenceTextCleaner.ts      cleanReferenceText + decodeHtmlEntities
    confidenceScorer.ts          tokenize (Türkçe stopwords) + score
    coverageCheck.ts             Her UI öğesi dokümanda geçiyor mu? (substring)
    verifiedCoverage.ts          Haiku LLM-judge ile "anlamlı anlatıldı mı?"
    markdownCleaner.ts           LLM çıktısı temizleme
    sourcePriority.ts            sourceType → ağırlık
    sidebarNav.ts                SIDEBAR_NAV_HINTS + isSidebarNav (tek kaynak)
    usageCost.ts                 Cache-aware token→USD maliyet (saf,
                                 computeUsageCost + aggregateUsage)
    screenshotRefs.ts            Kullanılan görüntü kümesi (saf) — bakım
                                 temizliği için; gömülü+küçük-resim+
                                 dokümante-edilmemiş-state mantığı
  generator/
    userManualGenerator.ts       Kullanıcı kılavuzu prompt + üretim
                                  (generateUserManualComplete: sekme başına
                                  ayrı çağrı + birleştirme)
    tabGrouping.ts               State'leri _tab_<i>'den sekmeye gruplar (saf)
    coverageFixUp.ts             Eksik UI öğeleri için hedefli ek üretim
    selectStates.ts              Hangi state görselleri prompt'a girer
    sectionRegenerator.ts        Tek bölümü Claude ile yeniden yaz
    markdownGenerator.ts         Markdown formatlama yardımcısı
    chunkedClaudeRefiner.ts      Uzun bağlamı parçalayarak refine
    contextExporter.ts           Trace footer için bağlam dökümü
    evidenceMapper.ts            Hangi referans hangi cümleyi besledi
  publisher/
    confluencePublisher.ts       v2 API + OAuth bearer (v1 410 Gone — kullanılmaz)
  export/
    wordExporter.ts              Markdown → DOCX (docx paketi)
  server/
    app.ts                       Express, heartbeat, watchdog, orphan-reap (183 satır)
    auth/atlassianAuth.ts        OAuth 3LO + scope + token refresh + cloud_id (285)
    jobs/
      documentationJob.ts        Orchestrator (slim ~100 satır)
      contextLoader.ts           Job-stable bağlam (BRD/Confluence/Jira/Swagger/şablon)
      screenProcessor.ts         Ekran başına analyze+generate+fixup+persist
      traceBuilder.ts            Doküman footer "Üretim Bilgisi"
      discoveryJob.ts            Ekran keşfi job'ı (189 satır)
    middleware/
      csrfGuard.ts               Mutating endpoint'lere X-DocAgent header şartı
    routes/
      discoveryRoutes.ts         POST /api/discovery/start, GET /screens, /stream
      jobRoutes.ts               start/cancel/pause/resume/delete/cleanup/stream
      documentRoutes.ts          CRUD + sections/regenerate + versions/restore
      confluenceRoutes.ts        pages/search + publish
      exportRoutes.ts            docx | markdown | pdf | zip
      referenceRoutes.ts         confluence/fetch + swagger/fetch + documents/upload
      sourceRoutes.ts            Confluence space + Jira project sources
      settingsRoutes.ts          .env okuma/yazma, mask
      promptRoutes.ts            data/prompts/config.json CRUD
      statsRoutes.ts             Dashboard sayaçları
      authRoutes.ts              Atlassian OAuth start/callback/disconnect/test
      maintenanceRoutes.ts       cleanup-screenshots (screenshotRefs ile
                                 kullanılmayan tespiti), disk-usage
      updateRoutes.ts            git pull + log
    store/
      atomicJson.ts              writeJsonAtomic + readJsonSafe
      jobStore.ts                data/db/jobs.json
      screenStore.ts             data/db/screens.json
      documentStore.ts           data/db/documents.json (versions[] dahil)
      referenceStore.ts          data/db/references.json (confluence/swagger/documents/sources/jira)
      eventBus.ts                SSE event emitter (job ID → subscribers).
                                 JobEvent.type: progress | screen |
                                 complete | error | failed | cancelled.
                                 TERMINAL = complete/failed/cancelled
                                 (stream kapanır). "error" = tek-ekran
                                 hatası, NON-terminal — job devam eder,
                                 frontend stream'i kapatmaz.
      jobCancellation.ts         Cancel + pause/resume lock
data/
  brd/                           Yerel BRD .md
  swagger/                       Yerel swagger .json
  screenshots/                   Discovery PNG çıktıları
  references/
    confluence/                  pageId.txt (cleaned)
    jira/                        PROJECT.json (issue dump)
    documents/                   uploaded BRD/.docx/.pdf text
    templates/                   örnek kılavuz şablonları
    _tmp/                        multer upload temp
  db/                            JSON persistence
  exports/                       DOCX/PDF download geçici
  prompts/config.json            promptConfig kaynağı
  logs/                          supervisor + server logları
client/                          React 19 + Vite + Tailwind v4 (slate+teal)
scripts/
  launch.sh                      AppleScript-safe launcher
  supervisor.js                  Express+Vite parent süreç
  create-launcher.sh             ~/Desktop/DocAgent.app üret
electron/main.js                 Opsiyonel Electron paket
```

---

## Partial Retry (eksik ekran üretimi)

`Job.screenPaths` job oluşturulurken kaydedilir. Failed/cancelled/completed
job'larda **eksik ekran set'i** = `screenPaths \ documentStore.getByJobId().
screenPath`. UI bunu kullanır:

```
GET  /api/jobs                        → her job + missingScreenCount
GET  /api/jobs/:jobId                 → ... + missingScreenCount
POST /api/jobs/:jobId/retry-missing   → yalnız eksik path'lerle yeni job
                                        başlat; orijinal job dokunulmaz
```

HistoryPage'de eksiği olan job satırında "⟳ Eksikleri Üret (N)" düğmesi.
Token tasarrufu: tamamlanmış ekranlar yeniden ödenmez. Eski sürümden
kalma job'larda `screenPaths` undefined → endpoint 400 döner (UI butonu
da gizler).

## Job Durumları & Yaşam Döngüsü

```
pending → running → (paused ⇄ running) → completed
                                       → failed
                                       → cancelled (kullanıcı iptal)
```

- `jobStore.update(id, {status})` ile geçilir.
- `jobCancellation.cancel(id)` → bir sonraki checkpoint'te kontrol edilir
  (`isCancelled(jobId)` ve `waitIfPaused(jobId)` job içinde çağrılır).
- Sunucu yeniden başladığında 'running'/'pending' kalmış job'lar `failed`
  olarak işaretlenir (app.ts orphan-reap bloğu).

---

## app.ts — Kritik Bölümler

### Middleware
- `cors({ origin: localhost-only })` — sadece `localhost/127.0.0.1/::1`
  origin'leri yansıtılır; origin'siz istekler (curl/Postman) geçerli.
  Cross-origin sitenin `/api/references`'ten metadata sızdırmasını engeller.
- `express.json({ limit: "10mb" })`
- **`csrfGuard`** — non-GET ve OAuth/beacon dışı her istekte
  `X-DocAgent: 1` header'ı şart. Cross-origin kötü niyetli sitelerin
  preflight'sız mutasyon endpoint'lerini tetiklemesini engeller.
  Frontend `client/src/lib/api.ts` (`DOCAGENT_HEADER`) ve tüm doğrudan
  fetch çağrıları header'ı zaten gönderir. 403 dönerse `request()`
  helper'ı `CsrfBlockedError` fırlatır + `docagent:csrf-blocked` window
  event emit eder; `App.tsx` global toast gösterir (4sn debounce).

### Route mount (satır 34-47)
```
/api/discovery   /api/jobs     /api/documents   /api/confluence
/api/export      /api/settings /api/prompts     /api/references
/api/sources     /api/stats    /api/auth        /api/maintenance
/api/update
/screenshots                                            (static)
```

### Heartbeat / auto-shutdown (satır 54-115)
```ts
LEAVE_GRACE        = 30_000           // sekme leave → exit grace
HEARTBEAT_FALLBACK = 15 * 60_000      // çökme yedeği (background throttle dostu)
CHECK_INTERVAL     = 30_000

POST /api/heartbeat        → lastHeartbeat = now, leaveTimer iptal
POST /api/heartbeat/leave  → leaveTimer başlat (varsa hiçbir şey yapma)
```
Sekme kapatınca `pagehide` → `sendBeacon('/api/heartbeat/leave')` → 30sn
içinde reconnect yoksa `process.exit(0)`. Yenileme `pagehide` tetikler ama
yeniden yüklenen sayfa heartbeat ile iptal eder.

### Job runtime watchdog
```ts
JOB_STALE_MS    = 3 * 60 * 60_000   // updatedAt 3 saattir hareketsiz → hung
JOB_HARD_MAX_MS = 12 * 60 * 60_000  // hard limit; gerçekten kaçak süreçler
// her 5 dakikada bir kontrol
```
`updatedAt` her ekran tamamlandığında (jobStore.update otomatik) tazelenir,
yani 50-80 ekranlık büyük doc job'ları öldürmez. Eskiden 30 dk sabit eşik
büyük üretimleri yarıda kesiyordu.

### Orphan job reap (satır 162-177)
Boot'ta running/pending job'lar `failed` olarak temizlenir.

---

## llm/claudeClient.ts — Claude Backend

```ts
MODEL_QUALITY = "claude-sonnet-4-6"   // kalite-kritik üretim (analiz, kılavuz, fix-up, bölüm düzenleme)
MODEL_FAST    = "claude-haiku-4-5"    // ucuz/hızlı doğrulama-yargı (coverage judge)
env.claudeBackend = 'cli' (varsayılan) | 'api'
env.claudeCliBin  = 'claude'
```

**Her `callClaude()` çağrısı `model` alanını açıkça geçer** (screenAnalyzer,
userManualGenerator, coverageFixUp, sectionRegenerator → `MODEL_QUALITY`;
verifiedCoverage'ın `judgeCovered` → `MODEL_FAST`). Bu bilinçli bir tercih:
CLI backend'de `model` verilmezse `--model` flag'i hiç eklenmez ve `claude`
süreci kullanıcının **kişisel** `claude` CLI varsayılanını (kendi `/model`
ayarı) kullanır — DocAgent'ın üretim kalitesi/maliyeti ilgisiz bir terminal
ayarına bağlı kalmasın diye artık her görev kendi modelini sabitler. Ucuz
modele indirgeme yalnız judge (Haiku) için yapılır; diğer görevler kaliteyi
doğrudan etkilediği için Sonnet'te kalır (bkz. `tests/claudeClient.test.ts`
"model sabitleri" — regresyon koruması).

İki yol:
- **CLI**: `spawn(claude, [prompt, --output-format=json])` — Claude Code'un
  yerel oturumunu kullanır, API key gerekmez. PATH sanitize edilmişse
  `resolveClaudeBin()` `~/.local/bin`, `~/.claude/local`, `/usr/local/bin`,
  `/opt/homebrew/bin` fallback'larını dener.
- **API**: `@anthropic-ai/sdk` `messages.create` — `ANTHROPIC_API_KEY` gerekir.
  `max_tokens` opsiyonel (default **8000**). Görseller `base64` veya dosya path.

```ts
isPromptTooLong(err) → boolean         // generator backoff için
isTransientError(err) → boolean        // retry (529/429/timeout/ECONNRESET/
                                       //   ECONNREFUSED) — export, test'li
isUsageLimitError(err) → boolean       // haftalık/kullanım/quota/billing limiti
                                       //   (geçici DEĞİL). Üretimde limit →
                                       //   generateUserManualComplete TEMİZ
                                       //   fırlatır (yarım doküman YOK);
                                       //   screenProcessor ekranı failed +
                                       //   job'a net mesaj → 'Eksikleri Üret'.
friendlyCliError(out,err,code)         // CLI exit≠0 / is_error:true → stdout
                                       //   JSON'dan anlamlı mesaj; 401 auth
                                       //   ipucu. Jenerik "exit 1" gizlemez.
ClaudeResult.truncated                 // stop_reason === 'max_tokens' → true
ClaudeResult.stopReason                // Claude'un duruş nedeni (opsiyonel)
ClaudeResult.cacheReadTokens           // ephemeral cache okuma (0.1× ücret)
ClaudeResult.cacheCreationTokens       // cache yazımı (1.25× ücret)
ClaudeCallOptions.cachedPrefix         // job-stable text block → ephemeral cache
```

**Token muhasebesi cache-aware:** `cache_read`/`cache_creation` token'ları
hem API hem CLI backend'den çıkarılır, `GenerationResult`/`FixUpResult` →
`screenProcessor` → `documentStore` (cacheReadTokens/cacheCreationTokens) →
`statsRoutes` zinciriyle taşınır. Maliyet `quality/usageCost.ts` ile
hesaplanır: input 3$, output 15$, cache-write 3.75$, cache-read 0.30$/M.
Eskiden dashboard maliyeti caching açıkken cache token'ı saymadığı için
eksikti.

**Prompt caching:** `callApi` `cachedPrefix`'i ilk content bloğu olarak
`cache_control: { type: "ephemeral" }` ile gönderir. Generator'lar
`buildPrompt` çıktısını `{ cachedPrefix, prompt }` olarak ikiye böler;
cachedPrefix = role + outputStructure + kurallar + şablonlar (aynı job
için byte-byte aynı). Aynı job içinde N ekran üretiminde 2. ekrandan
itibaren cache hit → input token maliyeti ~%10'a düşer. Cache kazancı
console'da `[claude] cache: read=... create=...` olarak loglanır.
CLI backend caching desteklemediği için prefix prompt'a önceler (eşit
metin akışı, kazançsız). Cache eşiği ~1024 token; şablon yoksa devreye
girmeyebilir (zararı yok).
Truncation: API & CLI backend `stop_reason === 'max_tokens'` durumunu
algılar; `[claude] ÇIKTI KESİLDİ` warning'i loglanır, `GenerationResult.
truncated` üretilen dökümana taşınır ve `documentationJob` trace
footer'ına ⚠️ uyarısı eklenir.

---

## src/config — Ortam ve Promptlar

### env.ts (lazy getters)
```ts
ANTHROPIC_API_KEY
CONFLUENCE_BASE_URL  CONFLUENCE_EMAIL  CONFLUENCE_API_TOKEN
CONFLUENCE_SPACE_KEY  CONFLUENCE_PARENT_PAGE_ID
APP_BASE_URL  APP_USERNAME  APP_PASSWORD
DOC_LANGUAGE = 'tr'
MAX_DISCOVERY_DEPTH = 0           // 0 → tek ekran modu (interactive=true)
PORT = 3000                       // tüm yerel URL'lerin tek kaynağı
CLAUDE_BACKEND = 'cli' | 'api'
CLAUDE_CLI_BIN = 'claude'
COVERAGE_LLM_JUDGE = true          // Haiku coverage doğrulama
FILL_TEST_DATA = true              // keşifte form/modal'ı test verisiyle
                                   //   doldur → dolu-form + validation +
                                   //   okuma-submit state'leri
ALLOW_FORM_SUBMIT = false          // ⚠️ açıkken Kaydet/Gönder GERÇEKTEN
                                   //   tıklanır → hedef app'te gerçek kayıt.
                                   //   Yalnız test/staging. Varsayılan kapalı.
DEEP_EXPLORE = true                // her sekmenin İÇİNİ ayrı derinlemesine
                                   //   gez (sekme-içi buton/modal/form). Çok
                                   //   sekmeli ekranda süre/maliyet artar.
```
Lazy getter — Ayarlar'dan değiştirilince sunucu restart gerekmez.

### promptConfig.ts
`data/prompts/config.json` → `{ userManual: {…}, technicalDoc: {…}, …}`. Her
prompt için: `role`, `outputStructure`, `instructions`, `rules[]`, `language`,
`maxTokens`. Boş ise generator kendi defaults'ı kullanır.

---

## Doküman Üretim Pipeline'ı

`runDocumentationJob(jobId, selectedScreenPaths[])` üç modülden oluşur:

| Modül | Rol |
|---|---|
| `documentationJob.ts` | Orchestrator — context load + paralel worker + finalize |
| `contextLoader.ts` | Tüm referans kaynaklarını okur, dedupe eder, döndürür |
| `screenProcessor.ts` | Tek ekran için analyze + generate + fixup + persist |
| `traceBuilder.ts` | "Üretim Bilgisi" footer'ı oluşturur |

Ekranlar **3'lü paralel** işlenir:

```ts
CONCURRENCY = 3   // documentationJob.ts
```

### Bağlam yükleme adımları
1. **Yerel swagger** dosyaları → `extractEndpoints`
2. **Swagger referansları** (URL ile çekilenler)
3. **BRD** `data/brd/*.md` → `parseBrdSections`
4. **Yüklenen dökümanlar** (.docx/.pdf/.md/.txt) → `cleanReferenceText` →
   `parseDocumentSections` (dispatcher; markdown varsa `parseBrdSections`,
   yoksa `parseFlatTextSections` ile sezgisel heading tespiti — numbered
   outline `1.1.` + standalone ALL-CAPS `AMAÇ/GEREKSİNİMLER`). `docRef.type`
   `"reference"` ise `sourceType: "process_analysis"` (priority 0.95),
   `"brd"` ise `sourceType: "brd"` (priority 1.0).
5. **Stored Confluence** (`referenceStore.getAllConfluence()`) →
   `decodeHtmlEntities` + `cleanReferenceText` → bölüm
6. **5b. Stored Jira** (`getAllJira()`) → her issue ayrı section
   (`sourceType: 'jira_task'`)
7. **Legacy Confluence env taraması** (`readConfluencePages`) →
   **sadece kayıtlı space source yoksa** çalışır (yeni Veri Kaynakları
   bunu kapsadığı için çift okuma engellendi)
8. **Şablonlar** → `referenceStore.getDocuments('template')` →
   `cleanReferenceText` → `templateContents[]`
9. **Çift okuma temizliği** — `confluence_*` ve `jira_*` id'leri tekilleştirilir
   (BRD bölümleri dokunulmaz; başlık çakışmasıyla yanlış birleşme olmasın diye)

Log:
```
[docjob ID] CONTEXT INVENTORY:
  - Endpoints: N
  - BRD/Confluence sections: M
  - Section types: {"brd":4,"confluence":2,"jira_task":3}
  - Templates: K
```

### Ekran başına döngü (paralel)
```ts
analyzeScreen(screen)        // Claude görsel analiz
buildScreenContext(screen, analysis, allSections, allEndpoints)
   → preparedChunks (16KB bütçe, 2.2KB chunk)
   → paragraphMatches (max 9, minHits 2)
   → relatedEndpoints (top 12)

generateUserManualComplete(context, templates, onProgress)
  // teknik doküman üretimi kaldırıldı — yalnız kullanıcı kılavuzu üretilir
```

### Coverage + Fix-up
```ts
env.fixUpThreshold     // FIX_UP_THRESHOLD (.env, 0-100, varsayılan 90)
env.fixUpMaxPasses     // FIX_UP_MAX_PASSES (.env, 0-5, varsayılan 2)

inScopeForCoverage = uiElements
   .filter(el => el.type !== "menu" && !isSidebarNav(el))

computeCoverage(els, body) → { coveragePct, missing[] }
```
**Early-stop:** kapsam % aynı kaldığında bile **eksik öğe set'i**
değiştiyse bir sonraki tur denenir (farklı eksiklere yönelinme şansı).
Yalnızca set birebir aynı olduğunda durulur.

**LLM-as-judge (env.coverageLlmJudge, default true):** İlk coverage
hesabı Haiku 4.5 ile doğrulanır — substring match "label var" der ama
"anlamlı anlatıldı" garanti etmez (örn. "Kaydet butonu görünür"
açıklama değil). Haiku her "covered" öğe için yes/no döner; "anlatılmadı"
denenler missing'e geri taşınır → fix-up doğru hedefe yönelir. Fix-up
iterasyonları raw substring kullanır (hız). Haiku çağrısı başarısız
olursa raw substring'e graceful fallback (asla regresyon yapmaz).
Maliyet ~$0.005/ekran. `COVERAGE_LLM_JUDGE=false` ile devre dışı.
Her tur:
- `runCoverageFixUp({docKind, currentContent, missing, uiElementsMissing})`
- Yeni kapsam **eski kapsam ≥** ise kabul, gerileme reddedilir
- İlerleme yoksa erken çık

**Çok-sekmeli ekranda hedef = YALNIZ GENEL BAKIŞ:** coverage `analysis.
uiElements` (ana ekran, 1 görsel) üzerinden ölçülür → bu öğeler genel bakış
bölümüne aittir. `generateUserManualComplete` `overviewContent`/`tabsContent`
ayrık döndürür; screenProcessor coverage-judge + fix-up'ı yalnız
`overviewContent`'te çalıştırır, sonra `fixedOverview + SECTION_JOINER +
tabsContent` birleştirir. Sekme bölümleri yeniden yazılmaz → ~8× token
tasarrufu + yapı/kalite korunur. Tek/sıfır sekmede tüm doc üzerinde (eskisi gibi).

### Üretim Bilgisi dipnotu (trace)
Doküman sonuna eklenir:
- Referans bölümleri (kaynak tipi dökümü: BRD/Confluence/Jira/…)
- API endpoint sayısı + ilk 5 path
- Şablonlar
- Ekran state sayısı
- UI kapsamı % + eksikler (varsa ilk 5)
- Fix-up uygulandı mı + kaç öğe eklendi
- ⚠️ Çıktı kesildi uyarısı (Claude `max_tokens` limitine takıldıysa)
- Üretim zamanı

---

## RAG Mekaniği

### tokenize (confidenceScorer.ts)
- Lower-case, harf+rakam dışı temizle, ≥3 char, **yalnızca dilbilgisel
  dolgu** stopword'leri filtreli: `ve, ile, için, bir, bu, şu, o, the,
  a, an, is, are, of, to, in, on, at, as, by, or, var, yok, vardır,
  olur, ise, de, da`. (Eskiden burada olan "kullanıcı, ekran, sayfa,
  tıkla*, açılır" çıkarıldı — bunlar gerçek sorgu token'ı olabilir.)
- **Suffix toleransı (Türkçe çekim, Unicode-aware):** `buildTokenRegex(token)`
  = `(?<![\\p{L}\\p{N}])<token>[\\p{L}\\p{N}]{0,8}(?![\\p{L}\\p{N}])`
  flags `giu`. "filtre" sorgusu "filtreler", "filtreyi", "filtreyı",
  "süzgeçleri" gibi formları yakalar. `\\w` ASCII-only olduğu için
  `\\p{L}\\p{N}` + `u` flag şart; aksi halde ı/ş/ğ/ç/ö/ü harfleri
  kaçardı. **Sınırlama:** ünsüz yumuşaması (k→ğ, p→b, t→d, ç→c) stem'i
  değiştirir; "etkinlik" → "etkinliği" eşleşmez (tam morfolojik
  stemmer gerekir, kapsam dışı). confidenceScorer ve paragraphSearch
  aynı kalıbı kullanır.

### sourcePriority (numerik çarpan)
```
brd                 1.0
process_analysis    0.95
confluence          0.85
jira_task           0.75
manual              0.6
default             0.5
```

### contextBudget.prepareDocumentChunks
```ts
totalBudget   = 16_000   (screenContextBuilder çağrısı)
perChunkMax   =  2_200
chunkSection: long content → split by ## / ### sub-heading then paragraph
diversity dedup: Jaccard(title-tokens) > 0.7 AND same sourceType → atla
firstChunk-only: uzun section için yalnız ilk chunk (giriş paragrafı)
```

### balanceBySourceType (screenContextBuilder.ts)
```ts
GUARANTEED_PER_TYPE = 2
```
Her ilgili `sourceType`'tan ilk 2'si önce sıralamaya alınır; geri kalan
global skora göre. BRD'nin tüm bütçeyi yutması bu sayede engellenir.

### paragraphSearch (yeniden buildScreenContext'te)
```ts
{ minHits: 2, maxPerSection: 2, maxTotal: 9 }
// ≥4 char tokens (3 char paragraf düzeyinde fazla gürültü)
// paragraf uzunluk eşiği: 30-2500 char (eski 60-2500; süreç analizi
// soruları 30-80 char olabildiği için aşağı çekildi)
// preparedChunks'taki başlıklarda olanlar elenir
```

---

## Generators — Kullanıcı Kılavuzu

### Çok sekmeli ekran — sekme başına ayrı üretim + birleştirme
`generateUserManualComplete(ctx, templates)` (screenProcessor bunu çağırır):
`tabGrouping.groupStatesByTab` ile state'leri screenshot adı `_tab_<i>`
deseninden sekmelere böler. **≥2 sekme** varsa → genel-bakış bölümü
(sekme-dışı state'ler) + HER SEKME için AYRI `generateUserManualSection`
çağrısı (`focus: { statesOverride, tabLabel }` → odaklı `## <ad> Sekmesi`
bölümü, ekran girişini tekrarlamaz) → tek dokümanda birleştirilir
(token/cache toplanır). Tek/sıfır sekmede tek çağrı. Amaç: tek çağrının
görsel bütçesine (TOTAL_MAX) sıkışıp sekme detayının kaybolmaması — her
sekme kendi tam görsel setiyle modele girer. İlerleme: `onProgress`
callback ile "Bölüm i/N tamamlandı" mesajı (screenProcessor → setProgress).
Bölümler **sınırlı-eşzamanlı** üretilir (`TAB_GEN_CONCURRENCY`, vars. 3);
birleştirme SIRA index'iyle korunur → token/kalite etkilenmez, süre kısalır.

**YALIN SEKME MODU (token tasarrufu):** `buildPrompt`'ta `tabFocus` varsa
sekmeye göre değişmeyen ağır bağlam ÇIKARILIR — BRD/Confluence RAG
(preparedChunks), API endpoint'leri ve stil şablonu (bunlar genel-bakışa
ait). Ekranın ana keşif görseli de gönderilmez (sekmenin kendi tam-sayfa
görseli yeterli). UI öğeleri + iş akışları + hedefli paragraf eşleşmeleri
KORUNUR (doğruluk korunur). Sekme prompt'u ~45K → ~20K; ekran başına ~40K+
token tasarrufu. Stil şablonu sekmelerde ÖZET (3500 char) kalır (genel
bakış 7000) — doküman örnek şablona benzesin diye.
**Standart başlık tekrarı önlenir:** `buildPromptFooter(cfg, {skipStructure})`
ile tam çıktı yapısı (Filtreler/Modallar/Sık Sorular/Ekrana İlk Bakış…)
sekme çağrılarına EKLENMEZ — yalnız genel bakışta bir kez. Sekme talimatı
ortak/standart bölümleri üretmeyi yasaklar (aksi halde her sekme bu
başlıkları tekrarlıyordu). Test: `tests/userManualLean.test.ts`.
**Ekran-geneli mekanik tekrarı önlenir:** çok-sekmede genel bakış çağrısı
`ManualFocus.overviewTabs` (sekme adları) alır → prompt'a "ORTAK MEKANİKLERİ
BURADA BİR KEZ ANLAT" görevi eklenir (tablo kullanımı/sıralama/arama,
sayfalama, 'sayfa başına kayıt sayısı', ortak filtre + satır işlemleri).
Sekme prompt'unda "EKRAN-GENELİ MEKANİKLER YASAK" kuralı: bu mekanikler
yazılmaz, "Genel Bakış bölümüne bakın" referansı verilir; sütunlar kısa
madde listesi olarak verilir, 'Tablo Görünümü' gibi genel bölüm yazılmaz
(eskiden her sekme tablo mekaniğini + sayfa-başına-kayıt'ı yeniden
anlatıyordu). Test: `tests/userManualLean.test.ts` "ortak mekanikler".

`userManualGenerator.ts`:
- `buildPrompt(ctx, templates, tabFocus?, overviewTabs?)`:
  - `brdContext`  = preparedChunks her biri `### Başlık (sourceType)` + içerik
  - `paragraphContext` = paragraphMatches blockquote
  - `apiContext` = `- [METHOD] /path — summary`
  - `uiElementsBlock` = sidebar-nav filtrelenmiş öğeler numaralı liste
  - `workflowsBlock` = isimli akış + adımlar
  - `templateBlock` = ilk 7000 char (üslup taklidi — içerik kopyalama YASAK)
  - `stateBlock` = `buildScreenshotEmbedBlock(mainImgUrl, states, path)`
    (export, saf, test'li). **Hiç state olmasa bile ana ekran görseli
    HER ZAMAN embed talimatına girer** — eski hata: stateCount=0'da blok
    komple düşüyordu → görüntüsüz kılavuz. min embed = `min(görselSayısı,12)`
    (1..12; mevcut görselden fazla embed istenmez).
- Backoff tier'ları:
  - `runWithBudget(allStates, 7000)` → fail (`isPromptTooLong`) →
  - `runWithBudget(max(5,half), 3500)` → fail →
  - `runWithBudget(4, 1500)` (minimal)

Sidebar-nav filtre: `src/quality/sidebarNav.ts` → `isSidebarNav(el)`.
Birincil kaynak: `analyzeScreen` her UI öğesine `isGlobalNav: boolean`
ataması yapar (LLM kararı; hedef uygulamadan bağımsız). `isSidebarNav`
bu alanı önce kontrol eder; tanımlı değilse (eski cached analizler için)
`SIDEBAR_NAV_HINTS` hardcoded liste fallback olarak devreye girer. Cache
zamanla yenilendikçe fallback gereksizleşir — listeyi tamamen çıkarmadan
önce regression doğrula.

---

## Discovery — Ekran Keşfi

`browser/screenDiscovery.ts` + `interactiveExplorer.ts`. `env.maxDiscoveryDepth=0`
→ tek ekran modu, `interactive=true`.

### Limitler (interactiveExplorer.ts:31)
```ts
MAX = { tabs: 8, dropdowns: 5, modals: 10, dates: 4 }
```

### MODAL_KEYWORDS (yakalama önceliği)
`add, yeni, ekle, edit, düzenle, filter, log, detay, info, +, manual, …`
satır 141. Eşleşen butonların priority=2, diğerleri 1.

### Akış
- Filters pre-pass (13 farklı selector — `[role=button]:has-text`, `[aria-label*=filter]`, `[class*=FilterHeader]`, vb.)
- Tabs (≤6) → Dropdowns (≤5) → Column headers → Row actions →
  **Action button pass (priority-sorted, ≤10 modal)** →
  Date pickers → Checkboxes → Toggles
- Row-edit drill-down: `tbody tr:first-child [aria-label*=edit/...]`,
  `[title*=...]`, `a[href*=edit]`, `[class*=edit]` → tıkla → modal yakala
- Her durum için `screenshotCapture` ile PNG +
  `StoredScreenState{ label, triggeredBy, screenshotPath }`

### Yinelenen görsel dedup + modal kapatma (kritik)
- **İçerik-hash dedup, PER-SCOPE:** `makePushState(seen)` factory'si her
  görselin md5'ini `seen` setinde tutar; aynı görüntü scope içinde ikinci
  kez gelirse EKLENMEZ. **Her sekme KENDİ `seen` setini alır** (ana akış
  ayrı). KRİTİK: global dedup, Market/Player gibi görsel-benzer ama farklı
  sekmelerin modallerini "yinelenen" sayıp siliyordu → her sekmede "create
  ekranı yok" oluyordu. Scope-içi dedup yalnız aynı butonun aynı modalı
  tekrar yakalamasını engeller.
- **`closeModal` çok-yollu + tekrarlı** (Escape / kapat-iptal / backdrop,
  ≤4 tur) ve `runActionButtonPass` her turdan önce kalmış modalı kapatır;
  kapatılamazsa kalan butonları atlar. Modal kapanmazsa sonraki butonlar
  altında kalıp aynı modal tekrar yakalanıyordu (kök neden).

### Test-verisi doldurma + submit katmanları (formFiller)
Modal/panel açıldığında **boş form yerine dolu form** yakalanır:
`fillTestData(page, scope)` görünür alanları tür-duyarlı güvenli örnek
veriyle doldurur (e-posta→test@ornek.com, tarih→bugün, sayı→42, ad→"Örnek
Ad", açıklama→örnek metin; parola/file atlanır), select'te ilk anlamlı
seçeneği seçer, checkbox/radio işaretler. Doldurma sonrası `${kind} (dolu)`
state'i `clip<modal>` ile yakalanır. `sampleValueForField` saf + test'li.

**Submit-sonrası ekranları üç katmanda yakalanır** (`env.fillTestData`):
- **A — Doğrulama uyarısı (mutasyonsuz):** `triggerValidation()` bir
  zorunlu/e-posta alanı geçersiz yapıp `blur` eder → istemci-tarafı inline
  hata; sunucuya istek GİTMEZ. Hata tespit edilirse `doğrulama uyarısı`
  state'i, sonra yeniden geçerli değerle doldurma.
- **B — Okuma submit'i (mutasyonsuz, her zaman):** `clickSubmitButton(…,
  "read")` Ara/Filtrele/Listele gibi GET butonlarını gerçekten tıklar →
  `Filtre/arama sonucu` state'i. `classifySubmitButton()` saf + test'li
  (read > write önceliği; sil/delete → destructive, asla tıklanmaz).
- **C — Yazma submit'i (GERÇEK mutasyon, opt-in):** yalnız
  `env.allowFormSubmit` (ALLOW_FORM_SUBMIT=true, **varsayılan kapalı**)
  iken `clickSubmitButton(…, "write")` Kaydet/Gönder'i tıklar → hedef
  uygulamada **gerçek kayıt** oluşur, `Kayıt sonrası` ekranı yakalanır.
  Yalnız test/staging ortamında açılmalı.

Ekranın kendisi formsa (oluştur/düzenle/liste+filtre) en sonda ana-içerik
`fullPage` doldurulup aynı A/B/C katmanları uygulanır.

### Screenshot opsiyonları (screenshotCapture)
- `{ fullPage: true }` — alt-kıvrım altı dahil; yükseklik 2600px clamp.
  Ana ekran keşfinde varsayılan.
- `{ clip: <modalLocator> }` — açık modal'ı arka plan karartması olmadan
  kırpar (temiz modal görüntüsü). interactiveExplorer modal state'lerinde.

### selectStates — submit-akışı önceliği
`categorize()` yeni state tiplerini ayrı yüksek-öncelikli kategorilere
sokar: `kayit` (cap 4), `uyari` (cap 3), `sonuc` (cap 3), `dolu` (cap 6),
`modal` (cap 6 — derin keşifte sekme-içi modallar için yüksek),
`sekme` (cap 8 — her tab ayrı alt-ekran, hepsi kılavuza girmeli).
`TOTAL_MAX=22`. Bunlar adım-adım + submit-sonrası kılavuzun temeli olduğu
için eleme sırasında korunur.

### Sekme-içi derin keşif (env.deepExplore, default açık)
`interactiveExplorer.exploreContentArea` = TEK KAYNAK içerik keşfi:
dropdown → action button (create/add modal) → `runColumnHeaderPass` (kolon
sıralama) → `runRowActionPass` (satır menüsü) → `runRowEditDrilldown`
(önizleme/düzenle/detay ≤3) → tarih/checkbox/toggle/input → accordion →
inline form doldurma + okuma/yazma submit. Çağrılma:
- **Sekme varsa:** her sekme için ayrı (TAZE dedup scope + TAZE clickedLabels),
  state dosyaları `${base}_tab_${i}_*`. Ana içerik keşfi ATLANIR
  (`tabsExplored` guard) — aksi halde aktif sekme iki kez yakalanıp kılavuza
  yinelenen görsel giriyordu (çapraz-scope tekrar; veri kanıtlı bug).
- **Sekme yoksa:** bir kez `${base}_*`.
Sekme tespiti URL-tabanlı (`exploreTabs`): sekmeler genelde `?tab=N` URL'i
değiştirir; her sekmenin tıklayınca gittiği URL öğrenilir, sonra her sekmeye
`page.goto(url)` ile AÇIKÇA gidilir (DOM tıklamasından güvenilir). URL
değişmeyen sekmeler için tıklamaya düşer. Entegrasyon testi:
`tests/tabExploration.integration.test.ts` (Playwright + yerel fixture).
Hover + fallback bir kez. DEEP_EXPLORE=false → sekmeler tek tek gezilmez.

**Teknik doküman KALDIRILDI:** screenProcessor yalnız kullanıcı kılavuzu
üretir (`technicalDocContent=""`); DocumentsPage'de teknik sekme yok;
export'lar (md/pdf/zip/docx) yalnız kullanıcı kılavuzu içerir.

**Anlatım düzeni:** prompt her görseli kendi açıklamasının hemen altına
koymaya zorlar (arka arkaya görsel yığını yasak — adım→görsel→sonuç akışı).

### Global chrome dışlama (profil/dil/header)
`interactiveExplorer.isInNavOrSidebar` sidebar + üst bar (header/topbar/
navbar/appbar) + profil/hesap/dil/bildirim/çıkış kontrollerini yakalama
dışı bırakır — bunlar ekran içeriği değil sayfa şablonudur. Üretim
tarafında `sidebarNav` hint'leri + `screenAnalyzer` isGlobalNav (v3) +
userManual prompt "Yasak" notu aynı öğeleri kılavuzdan eler.

---

## Atlassian OAuth (server/auth/atlassianAuth.ts)

```ts
getRedirectUri() = `http://localhost:${env.port}/api/auth/atlassian/callback`
AUTH_BASE    = "https://auth.atlassian.com"
API_BASE     = "https://api.atlassian.com"

ATLASSIAN_SCOPES = [
  "read:space:confluence", "read:page:confluence",
  "write:page:confluence", "read:attachment:confluence",
  "write:attachment:confluence", "read:content-details:confluence",
  "read:jira-work", "write:jira-work",
  "offline_access"
].join(" ")
```

Token rotasyonu:
- `getValidAccessToken()` → `expiresAt - now < 60s` ise `refreshTokens`
- `.env`'e `ATLASSIAN_ACCESS_TOKEN/REFRESH_TOKEN/EXPIRES_AT/CLOUD_ID/SITE_URL/SCOPE`
  yazar (writeEnv hem dosyaya yazar hem `process.env`'i günceller).
- `getConfluenceApiBase(cloudId)` → `…/ex/confluence/<id>` (v2 kullanırken
  `…/wiki/api/v2` eklenir).
- `getJiraApiBase(cloudId)` → `…/ex/jira/<id>`.

---

## Upload Güvenliği (referenceRoutes.ts)

Multer şu kısıtlarla yapılandırılmıştır:
```ts
limits: { fileSize: 25MB, files: 1 }
fileFilter: .docx | .pdf | .md | .txt allowlist
```
`uploadOrJsonError` wrapper multer reject'ini 400/413 JSON yanıtına
çevirir (default 500 stack-trace yerine).

## Settings Yazma Güvenliği (settingsRoutes.ts)

```ts
ALLOWED_SETTINGS_KEYS = { CLAUDE_*, APP_*, ATLASSIAN_OAUTH_*,
   CONFLUENCE_*, MAX_DISCOVERY_DEPTH, PORT, FIX_UP_*, DOC_LANGUAGE,
   COVERAGE_LLM_JUDGE, FILL_TEST_DATA, ALLOW_FORM_SUBMIT }
```
- Allowlist dışı key sessizce atılır + warn log'lanır (örn. `PATH`,
  `NODE_OPTIONS` enjeksiyon denemesi).
- Value içinde `\n`/`\r` → 400 (env satır injection guard).
- `.env` dosyasına `0o600` mode (sahip-only) + writeFileSync sonrası
  `chmodSync` ile mevcut dosyada da zorlanır.
- ATLASSIAN_ACCESS_TOKEN/REFRESH_TOKEN allowlist'te YOK — onları
  `atlassianAuth.writeEnv` yazar; user UI'sından gelmemeli.

## referenceStore (server/store/referenceStore.ts)

DB: `data/db/references.json` (atomik yazımlı).

```ts
ReferenceDB = {
  confluence: ConfluenceRef[]   // pageId ile tekilleştirilir
  swagger:    SwaggerRef[]       // url ile tekilleştirilir
  documents:  DocumentRef[]      // type: 'brd' | 'reference' | 'template'
  sources:    SourceRef[]        // kind: 'confluence-space' | 'jira-project'
  jira:       JiraRef[]          // projectKey ile tekilleştirilir
}
```

Eski DB dosyaları için `sources` + `jira` alanları boş diziyle back-fill edilir.

---

## sourceSync (ingestion/sourceSync.ts)

```ts
syncConfluenceSpace(spaceKey) → { count, log[] }
   // v2 API: GET /spaces?keys=KEY → spaceId
   //         GET /pages?space-id=… (cursor pagination) → her sayfa için
   //         addConfluence({ url, pageId, title, spaceKey, contentFile,
   //                          syncedAt, wordCount })
   // htmlToText = decodeHtmlEntities(strip tags) + whitespace temizle

syncJiraProject(projectKey) → { count, log[] }
   // POST /rest/api/3/search/jql {jql, fields, maxResults:100, nextPageToken}
   // STATÜ FİLTRESİ: isExcludedJiraStatus() ile Backlog/To Do/Cancel
   //   (jiraStatusFilter.ts, Türkçe-fold normalize) issue'ları atlanır;
   //   JQL sade tutulur (status ismi projede yoksa JQL patlamasın diye
   //   post-filter). Atlanan sayısı log'a yazılır. contextLoader 5b'de
   //   eski sync'ler için defensive aynı filtre tekrar uygulanır.
   // description ADF ise adfToText() ile düzleştir
   // → data/references/jira/<KEY>.json + addJira()
```

---

## Confluence Publisher (publisher/confluencePublisher.ts)

Sadece **v2 API + OAuth bearer**. v1 API HTTP 410 Gone → kullanılmıyor.

```ts
getSpaceId(spaceKey) → numeric id
findPage(spaceId, title) → V2Page | null
publishMarkdown(spaceKey, title, markdown, parentPageId?) →
  - markdown → storage format dönüşümü
  - findPage varsa update, yoksa create
  - attachment upload **v1 multipart** kullanır (v2'de temiz endpoint yok)
    → başarısızlık fatal değil
```

---

## Export Routes (server/routes/exportRoutes.ts)

```
POST /api/export/docx       title + docs[] → .docx (docx paketi)
POST /api/export/markdown   tek birleşik .md (TOC + her ekran)
POST /api/export/pdf        marked → HTML → inlineScreenshots → Playwright
                              HTML→PDF. inlineScreenshots `/screenshots/<ad>`
                              referanslarını base64 data-URI ile GÖMER
                              (setContent origin'siz; aksi halde görseller boş).
POST /api/export/zip        bundle:
                              <slug>.md (birleşik)
                              <screen-slug>/kullanici-kilavuzu.md
                              screenshots/*
```
(Teknik doküman kaldırıldı — export'lar yalnız kullanıcı kılavuzu içerir.)

---

## Frontend (client/src)

React 19 + Vite + Tailwind v4. Tema runtime'da `[data-theme]` ile
geçişli (slate + teal). Default **dark**.

### Sayfalar (App.tsx page state)
```
dashboard    → DashboardPage      sayaçlar + son jobs + son docs
discovery    → DiscoveryPage      URL gir + Bağlam Filtresi + Başlat + ekran seç
documents    → DocumentsPage      ekrana göre gruplu liste + sürüm + bölüm regen
history      → HistoryPage        eski job arşivi
references   → ReferencesPage     5 sekme: Veri Kaynakları | Confluence | Swagger
                                    | Dökümanlar | Şablonlar
settings     → SettingsPage       Claude backend + API key + Atlassian OAuth
prompts      → PromptsPage        15 sistem prompt'u düzenle
update       → UpdatePage         git pull info + run + log
kilavuz      → KilavuzPage        client/public/kilavuz.html iframe (uygulama içi kılavuz)
```

### Üst çubuk: **Derin Analiz** anahtarı
`App.tsx` `deepAnalysis` state, `DiscoveryPage`'e prop olarak iletilir
(şu an analiz prompt'una derin akıl-yürütme talimatı eklemek için).

---

## Bu Belgenin Bakımı

**Her commit'ten sonra bu dosyanın güncelliğini doğrula.** Bir commit;
dosya yapısını, sabit/limitleri, route'ları, kalıcılık şemasını veya
çekirdek davranışlardan birini değiştirdiyse, ilgili bölümü buraya
yansıtıp **ayrı bir follow-up commit** at (CLAUDE.md değişikliğini
kod commit'iyle birleştirme — diff küçük ve anlaşılır kalsın).

Bu kuralı `.claude/settings.json` içindeki PostToolUse hook'u
(`.claude/hooks/check-claude-md.sh`) otomatik olarak her `git commit`
çağrısının ardından hatırlatır. Hook bozulursa veya farklı bir
istemciden çalışılıyorsa kural buradadır — Claude oturum bağlamına
CLAUDE.md'yi okur, kuralı görür, uygular.

İlgisiz commit'lerde (yalnızca CLAUDE.md, doküman dosyaları,
`.claude/`, README vb. değiştiyse) güncelleme yapmadan geç.

---

## Geliştirme Kuralları

1. **Türkçe** — kullanıcıya gösterilen mesaj, log Türkçe; teknik
   isim/sabit İngilizce.
2. Yeni route → app.ts mount listesine ekle.
3. Yeni job tipi → jobStore status enum'una ve orphan-reap'a uyumlu.
4. Yeni source type (BRD/Confluence/Jira dışı) → `sourcePriority.ts` +
   `documentSourceType` + dedupe id prefix politikası.
5. `referenceStore` her zaman `writeJsonAtomic` ile yaz (yarım yazım yok).
6. Claude çağrısı → her zaman `isPromptTooLong` backoff zincirine sar.
7. `.env` **asla** commit edilmez (ATLASSIAN_*, ANTHROPIC_API_KEY dahil).
   Yeni mutating endpoint (POST/PUT/PATCH/DELETE) eklediğinde frontend
   tarafında `lib/api.ts`'in `request()` helper'ı veya `DOCAGENT_HEADER`
   sabitiyle çağır — `csrfGuard` middleware aksi halde 403 döner.
8. Heartbeat sözleşmesini koru — `/api/heartbeat/leave` immediate exit
   tetiklemez; refresh güvenliği oradan gelir.
9. UI değişikliklerinde **renkler için semantic token** kullan
   (`bg-surface`, `text-fg2`, `bg-accent` …) — `bg-blue-600` gibi
   sabit renk yazma (Tailwind v4 `@theme inline` ile remap'lendi).

---

## Bilinen Kısıtlamalar

- **Tek kullanıcı / yerel uygulama** — multi-user veya server deploy yok.
- **JSON kalıcılık** — DB yok. `data/db/*.json` atomik yazım, fakat
  binlerce kayıt ölçeğinde rerank.
- **Yetkilendirme yok** — yerel kullanım varsayımıyla auth katmanı yok.
  Bu, **tek-kullanıcı tehdit modelidir**: kullanıcının kendisi düşman
  değil. Savunmalar şuna karşıdır:
  (1) açık bir kötü niyetli tarayıcı sekmesinin `localhost:3000`'e
  istek atması (CSRF guard + CORS localhost-only + settings allowlist
  + newline guard çözüyor),
  (2) `.env` dosyasının başka bir OS kullanıcısına veya bir cloud sync
  (Dropbox/iCloud) hizmetine sızması (mode 0o600).
  Pentest/server-side senaryoları kapsam dışı.
- **Prompt injection — yumuşak risk:** Synced Confluence/Jira sayfaları
  veya yüklenen BRD içeriği Claude'a olduğu gibi gönderilir. Birisinin
  bu kaynaklara "ignore previous instructions" tarzı talimat enjekte
  etmesi üretilen dokümanda yan etkiler oluşturabilir. Tam koruma zor;
  iş süreci olarak Confluence/Jira içeriğinin güvenilirliği şart.
- **CSRF guard tarayıcıya özgüdür** — `X-DocAgent` header'ı yalnız
  browser CSRF'ini engeller; aynı LAN'daki bir aktör direkt header'la
  istek atarsa geçer. Auth yok → bu tehdit zaten kapsam dışı, ama
  "uzaktan-RCE-engelleyici" bir koruma değildir.
- **Login arkası ekranlar** — `env.appUsername/Password` ile Playwright login
  destekli; cookie/SSO senaryoları zayıf.
- **PDF okuma** — `pdf-parse` v2 (PDFParse sınıfı), `require()` ile yüklenir.
  Çok büyük PDF'lerde tüm metin belleğe alınır.
- **Confluence attachment upload** v1 multipart kullanır (v2'de temiz
  endpoint yok); attachment hatası fatal değil.
- **Job watchdog 30 dakika** — büyük üretim işleri buna takılabilir
  (CONCURRENCY=3 ile ~25-30 ekran sınırda).
- **Test kapsamı sınırlı** — `tests/` altında vitest ile 76 birim test
  (BRD parser, sourcePriority, sidebar nav, coverage, section dedup,
  paragraph search, jira status, flat-text parser, confidence scorer,
  claudeClient helpers, usageCost, formFiller sampleValue +
  classifySubmitButton, selectStates). Üretim job'ı, generator prompt'u,
  OAuth flow ve Playwright tarayıcı etkileşiminin DOM tarafı (fillTestData /
  triggerValidation / clickSubmitButton) canlı hedef gerektirdiği için
  test edilmedi — saf çekirdekleri (değer üreteci, submit sınıflandırıcı)
  test'li.
- **CLI backend** Claude Code oturumu açık olmalı; `resolveClaudeBin()`
  AppleScript-sanitize PATH için fallback dener.

---

## Planlanan / Tamamlanan

### Tamamlanan
- ✅ Confluence v2 + granular OAuth scope migrasyonu (v1 410)
- ✅ HTML entity decode + TOC/header/pagemarker temizleme
- ✅ Source-type aware diversity dedup (BRD ↔ Confluence aynı başlık ayrı tutulur)
- ✅ Coverage fix-up döngüsü (≤2 tur, regresyon reddi)
- ✅ İnteraktif keşif: filtre paneli + modallar + row-edit drill-down
- ✅ Veri Kaynakları: Confluence space + Jira project sync
- ✅ Çift okuma temizliği (confluence_*/jira_* id dedupe + legacy scan conditional)
- ✅ balanceBySourceType (her referans tipi prompt'a giriyor)
- ✅ Analyst Studio tasarım dili port'u (slate+teal, light/dark)
- ✅ Heartbeat: `pagehide` beacon + grace timer (refresh güvenli, tab close
  ~30sn, background 15dk yedek)
- ✅ Cache-aware token muhasebesi + doğru USD maliyet (usageCost.ts)
- ✅ Otomatik test-verisi doldurma (formFiller) + dolu-form state yakalama
- ✅ Submit-sonrası yakalama: validation uyarısı (A) + okuma-submit/sonuç
     (B) güvenli; gerçek yazma-submit (C) ALLOW_FORM_SUBMIT ile opt-in
- ✅ Screenshot: ana ekran fullPage + modal clip (temiz/eksiksiz görsel)
- ✅ Kullanıcı kılavuzu prompt'u: adım-adım veri girişi + örnek değer zorunlu
- ✅ ECONNREFUSED retry typo düzeltmesi

### Yapılacak (öneri)
- ⏳ **Hybrid (keyword + embedding) retrieval** — şu an saf keyword
  (Türkçe çekim/eş anlamlı/dil karışımı kaçar). Plan: opt-in env var
  (`EMBEDDING_PROVIDER=voyage|openai|cohere`), keyword top-30 → semantic
  re-rank top-12, `data/embeddings/<sourceId>.json` cache (content
  hash'le invalidate). Maliyet pratik olarak sıfır. Quality guard:
  pure semantic değil hybrid; embedding kapalıyken mevcut davranış aynen.
- ⏳ DB'ye geçiş (binlerce referans / doküman ölçeğinde)
- ⏳ Çok kullanıcı + auth
- ⏳ Confluence attachment v2 native yol (v1 multipart yerine)
- ⏳ Test kapsamını genişlet (jenerator prompt builder, OAuth, Playwright)
- ⏳ Login akışı için SSO/cookie aktarımı standardı
- ⏳ Maliyet/karneleme — ekran başına token/maliyet kullanıcıya gösterilsin
