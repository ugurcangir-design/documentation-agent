# documentation-agent — Claude Code Context

DocAgent: ekranları Playwright ile gezip (BRD/Confluence/Jira/Swagger RAG) her
ekran için Türkçe **Kullanıcı Kılavuzu** üreten yerel masaüstü uygulaması.
Node + TS. API **:3000**, Vite client **:5173**.

> **Ayrıntılı mimari, RAG mekaniği, job yaşam döngüsü, dosya-fonksiyon haritası:
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).** Tüm repoyu tarama — önce oraya bak.

## Komutlar
- `npm run dev` — server + Vite paralel
- `npm test` — vitest (entegrasyon testleri Playwright/chromium gerektirir)
- `npm run build` — client production build
- `npm run cli` — CLI giriş noktası (src/index.ts)
- `npm run launcher` — masaüstü .app üret

## İlgili dosyalar (göreve göre — körlemesine tarama yok)
- Keşif/etkileşim yakalama: `src/browser/interactiveExplorer.ts`, `formFiller.ts`, `screenDiscovery.ts`
- Üretim/prompt: `src/generator/userManualGenerator.ts`, `tabGrouping.ts`, `selectStates.ts`
- Job orkestrasyon: `src/server/jobs/{documentationJob,screenProcessor,contextLoader,discoveryJob}.ts`
- Claude backend: `src/llm/claudeClient.ts`
- RAG: `src/retrieval/*`, `src/analysis/screenContextBuilder.ts`, `src/quality/*`
- Route'lar: `src/server/routes/*` · Persistence: `src/server/store/*` (JSON)
- Frontend: `client/src/pages/*`, `components/ProgressView.tsx`
- Env/config: `src/config/env.ts` (lazy getter — restart gerekmez)

## Kesin kurallar
1. Kullanıcıya gösterilen mesaj/log **Türkçe**; teknik isim/sabit İngilizce.
2. Mutating endpoint (POST/PUT/PATCH/DELETE) → frontend `lib/api.ts` `request()`
   veya `X-DocAgent` header kullan (`csrfGuard` aksi halde 403).
3. `referenceStore`/store yazımı **her zaman** `writeJsonAtomic`.
4. Claude çağrısı → her zaman `isPromptTooLong` backoff zincirine sar.
5. `.env` **asla** commit edilme (ANTHROPIC_API_KEY, ATLASSIAN_*, APP_*).
6. UI renkleri semantic token (`bg-surface`, `text-fg2`, `bg-accent`) — sabit renk yazma.
7. Yeni route → `app.ts` mount listesine ekle. Yeni store status → orphan-reap'e uyumlu.
8. SSE `JobEvent.type`: terminal = `complete|failed|cancelled`; `error` = tek-ekran (non-terminal).

## Env bayrakları (varsayılan)
`CLAUDE_BACKEND=cli` · `MAX_DISCOVERY_DEPTH=0` (0=tek ekran+interactive) ·
`FILL_TEST_DATA=true` · `DEEP_EXPLORE=true` (sekme-içi derin keşif) ·
`ALLOW_FORM_SUBMIT=false` (⚠ açıkken gerçek kayıt) · `PORT=3000` ·
`LIVE_APP_MCP_ENABLED=false` (opt-in: Claude + Playwright MCP canlı kanıt —
bkz. docs/ARCHITECTURE.md "Canlı Uygulama Kanıtı — MCP") ·
`ANNOTATE_STEPS=true` (tıklanacak öğeyi görselde işaretle) ·
`REDACT_SENSITIVE=false` (görselde PII blur) · `STYLE_LINT=true` (Haiku
biçimsel yazım denetimi, guardrail'li)

## Belge bakımı
Bir commit dosya yapısı/sabit/route/persistence/çekirdek davranışı değiştirdiyse,
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**'nin ilgili bölümünü ayrı bir
follow-up commit'le güncelle (kod commit'iyle birleştirme). İlgisiz commit'lerde geç.
