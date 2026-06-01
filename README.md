# DocAgent — Analyst Studio

Bir web uygulamasının ekranlarını Playwright ile tarayıp; BRD, Confluence,
Jira, Swagger ve örnek kılavuzlarla harmanlayarak her ekran için **Türkçe
Kullanıcı Kılavuzu + Teknik Döküman** üreten, yerel çalışan bir yapay zeka
döküman üretim ajanı.

> Tek kullanıcılı **yerel masaüstü uygulaması**. Sunucuya kurulmaz; her
> analist kendi makinesine kurar.

## Hızlı Başlangıç

```bash
# Gereksinim: Node.js ≥ 20.19, npm ≥ 10, git
git clone <repo-url>
cd documentation-agent

npm install                 # backend bağımlılıkları
(cd client && npm install)  # frontend bağımlılıkları
npm run install:browsers    # Playwright Chromium (~150 MB)

cp .env.example .env        # ardından .env'i düzenleyin (en az CLAUDE_BACKEND)
chmod 600 .env

npm test                    # 46 birim test — hepsi yeşil olmalı
npm run dev                 # API :3000 + arayüz :5173
```

Tarayıcıdan **http://localhost:5173** açın.

## Tam Kılavuz

Kurulum, ilk yapılandırma (Claude backend + Atlassian OAuth), kullanım,
sorun giderme ve SSS için ayrıntılı kılavuz:

**[EKIP-KURULUM-KILAVUZU.html](EKIP-KURULUM-KILAVUZU.html)** — tarayıcıda açın.

## Mimari Notları

Geliştiriciler için kod yapısı, RAG mekaniği, job yaşam döngüsü ve
çekirdek davranışlar **[CLAUDE.md](CLAUDE.md)** dosyasındadır.

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | API (3000) + Vite arayüz (5173) paralel |
| `npm test` | Vitest birim testleri |
| `npm run build` | Frontend production build |
| `npm run launcher` | macOS `DocAgent.app` masaüstü ikonu üret |

## Güvenlik

Yerel kullanım modeli: API'lar CSRF guard (`X-DocAgent` header) +
localhost-only CORS ile korunur, `.env` `0o600` modunda yazılır, ayar
yazımı allowlist'lidir. Detay: CLAUDE.md → Bilinen Kısıtlamalar.
