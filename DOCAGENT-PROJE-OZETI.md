# DocAgent — Proje Özeti

> Bu belge, projeyi Claude chat'e yükleyip diğer projelerle birlikte AI planı
> değerlendirmesi yapmak için hazırlanmıştır. Projenin ne olduğunu, nasıl
> çalıştığını, hangi girdileri aldığını ve hangi çıktıları ürettiğini özetler.

---

## 1. Tek Cümlede

**DocAgent**, bir web uygulamasının ekranlarını tarayıcı otomasyonuyla gezip
keşfeden; bu ekranları BRD, Confluence, Jira, Swagger/API ve örnek kılavuz gibi
kurumsal referanslarla birleştiren; ve her ekran için **Türkçe kullanıcı
kılavuzu** ile **teknik döküman** üreten, RAG tabanlı bir yapay zeka döküman
üretim ajanıdır.

İnsan analistin günlerce süren "ekranı incele → BRD ile eşleştir → kılavuz yaz →
Confluence'a yayımla" işini otomatikleştirir.

---

## 2. Çözdüğü Problem

Kurumsal yazılım projelerinde kullanıcı kılavuzu ve teknik dokümantasyon:

- **Elle yazılır** — yavaş, pahalı, tutarsız.
- **Eksik kalır** — ekrandaki her buton/alan/modal anlatılmaz.
- **Bağlamdan kopuktur** — BRD'deki iş kuralı, Swagger'daki endpoint, Confluence'taki
  süreç bilgisi kılavuza yansımaz.
- **Güncellenmez** — ekran değişince doküman eskir.

DocAgent bu dört sorunu; otomatik ekran keşfi + referans tabanlı bağlam kurma +
LLM üretimi + kapsam doğrulama döngüsü ile çözer.

---

## 3. Uçtan Uca Çalışma Akışı (Pipeline)

```
[1] Ekran Keşfi   →  [2] Bağlam Kurma   →  [3] Ekran Analizi
       ↓                    ↓                      ↓
   Playwright          RAG / Referanslar      Claude (görsel analiz)
       ↓                    ↓                      ↓
[4] İlgili Bağlam Seçimi (Retrieval)  →  [5] Döküman Üretimi
       ↓                                          ↓
   Skorlama + çeşitlilik + bütçe          Claude → Kılavuz + Teknik Doc
       ↓                                          ↓
[6] Kapsam Doğrulama + Otomatik Düzeltme  →  [7] Yayın / Dışa Aktarım
       ↓                                          ↓
   Her UI öğesi anlatıldı mı?            Confluence / DOCX / PDF / MD / ZIP
```

### Adım 1 — Ekran Keşfi (Discovery)
- **Playwright** ile başsız (headless) Chromium, hedef uygulama URL'sine gider.
- **Etkileşimli keşif:** sekmeler, modallar, açılır menüler, filtre panelleri,
  satır aksiyonları, "düzenle" ikonları öncelik sırasına göre tıklanır.
- Her durum (state) için **ekran görüntüsü** alınır: ana ekran + filtre paneli +
  her modal (Ekle / Düzenle / Detay / Log) + tooltip / dropdown vb.
- Örnek: tek bir ekran için 20–30 farklı durum görüntüsü yakalanabiliyor.

### Adım 2 — Bağlam Kurma (Referans Yükleme)
Tüm referans kaynakları okunur, temizlenir ve "bölüm"lere (section) ayrılır:
- Yüklenen BRD ve referans dökümanlar (.docx / .pdf / .md / .txt)
- Confluence sayfaları ve **tüm Confluence space'leri**
- **Jira projeleri** (tüm issue'lar)
- Swagger / OpenAPI spec'leri (yerel dosya veya URL)
- Örnek kullanıcı kılavuzu şablonları (üslup/format referansı)
- Metin temizleme: HTML entity çözümleme, PDF içindekiler tablosu/sayfa
  numarası/tekrarlayan başlık ayıklama.

### Adım 3 — Ekran Analizi
- Claude'a ekran görüntüleri + durum görüntüleri verilir.
- Çıktı: ekran başlığı, amacı, hedef kullanıcı, **UI öğeleri listesi**
  (buton/alan/filtre/tablo), **iş akışları** ve gösterilen veriler.

### Adım 4 — İlgili Bağlam Seçimi (Retrieval / RAG)
- Ekran başlığı + UI öğeleri + akışlar bir sorguya dönüştürülür.
- Tüm referans bölümleri **anahtar kelime + token benzerliğiyle** puanlanır.
- **Kaynak önceliği** uygulanır (BRD > Süreç Analizi > Confluence > Jira).
- **Çeşitlilik dengeleme:** her ilgili kaynak tipinden (BRD/Confluence/Jira/
  yüklenen doküman) en az birkaç bölümün prompt'a girmesi garanti edilir.
- **Bağlam bütçesi:** ~16 KB'lik bölüm + paragraf düzeyinde uzun-kuyruk eşleşme.
- İlgisiz bölümler (skor 0) elenir — yalnızca ilgili içerik kullanılır.

### Adım 5 — Döküman Üretimi
Her ekran için **iki ayrı doküman** Claude ile üretilir:
- **Kullanıcı Kılavuzu** — son kullanıcıya yönelik, adım adım, ekran
  görüntüleri gömülü Türkçe anlatım.
- **Teknik Döküman** — geliştiriciye yönelik, API endpoint'leri ve iş
  kurallarıyla ilişkilendirilmiş teknik açıklama.

### Adım 6 — Kalite Kontrolü
- **Kapsam doğrulama:** ekrandaki her UI öğesi dokümanda geçiyor mu?
- **Otomatik düzeltme döngüsü:** kapsam %90'ın altındaysa, eksik öğeler için
  hedefli olarak en fazla 2 tur yeniden üretim yapılır (gerileme olursa kabul
  edilmez).
- **Üretim izi (trace):** dokümanın altına hangi referansların, kaç endpoint'in,
  hangi şablonun kullanıldığı kaynak tipi dökümüyle eklenir.

### Adım 7 — Yayın / Dışa Aktarım
- **Confluence'a yayımlama** (Atlassian v2 REST API + OAuth).
- **Dışa aktarım:** Word (.docx), Markdown, PDF, ya da ekran görüntüleriyle
  birlikte ZIP paketi.

---

## 4. Girdiler (Referans Kaynakları)

| Kaynak | Nasıl eklenir | Kullanımı |
|---|---|---|
| Hedef uygulama URL'si | Ekran Keşfi sayfası | Ekranlar taranır |
| BRD / referans doküman | .docx/.pdf/.md/.txt yükleme | İş gereksinimleri bağlamı |
| Confluence sayfası | Sayfa URL'si | Tek sayfa bağlamı |
| **Confluence space** | Space key + Senkronize | Tüm sayfalar bağlama girer |
| **Jira projesi** | Proje key + Senkronize | Tüm issue'lar bağlama girer |
| Swagger / OpenAPI | URL veya dosya | API endpoint bağlamı |
| Örnek kılavuz şablonu | .docx/.pdf yükleme | Üslup ve format referansı |

---

## 5. Çıktılar

Her seçilen ekran için:

1. **Kullanıcı Kılavuzu (Markdown)** — ~15–25 KB; gömülü ekran görüntüleri
   (genelde 8–12 adet), adım adım iş akışları, modal/panel alt başlıkları,
   her buton ve filtre alanı açıklamalı.
2. **Teknik Döküman (Markdown)** — API endpoint eşleştirmeli teknik anlatım.
3. **Üretim Bilgisi dipnotu** — kullanılan kaynaklar, kapsam yüzdesi, eksikler.

Bunlar daha sonra:
- Confluence'a sayfa olarak yayımlanabilir,
- Word / PDF / Markdown / ZIP olarak indirilebilir,
- Uygulama içinde düzenlenebilir, bölüm bazında yeniden üretilebilir,
- Sürüm geçmişiyle saklanır.

---

## 6. Teknik Mimari

**Backend**
- Node.js + TypeScript, Express 5 REST API
- Gerçek zamanlı ilerleme için SSE (Server-Sent Events)
- Playwright (Chromium otomasyonu)
- Anthropic Claude — iki backend: **Claude Code CLI** veya **Anthropic SDK**
  (`claude-sonnet-4-6`); ayardan seçilir
- Atlassian OAuth 2.0 (3LO) — Confluence + Jira granular scope'lar
- Kalıcılık: atomik yazımlı JSON dosyaları (veritabanı yok — yerel, tek kullanıcı)

**Frontend**
- React 19 + Vite + Tailwind CSS v4
- Slate + teal tasarım sistemi, açık/koyu tema
- Sayfalar: Dashboard, Ekran Keşfi, Dökümanlar, Geçmiş, Referanslar
  (Veri Kaynakları dahil), Ayarlar, Sistem Promptları, Güncelleme

**Dağıtım**
- Yerel masaüstü uygulaması: launcher script + supervisor süreci
- Tarayıcı sekmesi yaşam döngüsü: sekme kapatılınca uygulama kapanır,
  yenilemede / arka planda açık kalır (heartbeat + `pagehide` sinyali)
- Opsiyonel Electron paketleme (`electron-builder`)

**Kod büyüklüğü (yaklaşık):** ~95 TypeScript modülü; ana alanlar — `browser/`
(keşif), `ingestion/` (kaynak okuma), `retrieval/` (RAG), `analysis/` (ekran
analizi), `generator/` (üretim), `quality/` (kalite), `publisher/` + `export/`
(çıktı), `server/` (API).

---

## 7. Öne Çıkan Yetenekler

- **Otomatik etkileşimli ekran keşfi** — sadece statik sayfa değil; modallar,
  filtreler, düzenleme ekranları öncelik sırasıyla açılıp yakalanır.
- **Çok kaynaklı RAG** — BRD + Confluence + Jira + Swagger + şablon aynı
  bağlamda; kaynak önceliği ve çeşitlilik dengelemesiyle.
- **Çift okuma koruması** — aynı sayfa/issue bağlama iki kez girmez.
- **Kapsam garantisi** — her UI öğesinin dokümanda yer alması doğrulanır,
  eksikler otomatik tamamlanır.
- **Format taklidi** — yüklenen örnek kılavuzun üslubu ve yapısı örnek alınır.
- **Görsel-temelli üretim** — LLM'e ekran görüntüleri verilir; doküman gerçek
  ekrana sadık kalır.
- **İki backend** — internet/maliyet kısıtına göre CLI veya API.

---

## 8. Mevcut Olgunluk Durumu

**Çalışan / doğrulanmış:**
- Uçtan uca akış canlı ortamda çalışıyor (keşif → analiz → üretim → yayın).
- Tek ekranda 30 durum görüntüsü yakalama, ~22 KB kullanıcı kılavuzu üretimi
  test edildi.
- Confluence space + Jira projesi senkronizasyonu gerçek Atlassian API'sine
  bağlanıyor.

**Sınırlamalar / olgunlaşmamış alanlar:**
- Tek kullanıcılı, yerel uygulama — çok kullanıcı / sunucu dağıtımı yok.
- Kalıcılık JSON dosyaları — ölçeklenebilir veritabanı yok.
- Kimlik doğrulama / yetkilendirme katmanı yok (yerel kullanım varsayımı).
- Otomatik test kapsamı sınırlı; doğrulama büyük ölçüde elle/canlı yapılıyor.
- LLM maliyeti ekran sayısıyla doğrusal artar (ekran başına 2 doküman + olası
  düzeltme turları).

---

## 9. AI Planı Değerlendirmesi İçin Özet

| Boyut | Durum |
|---|---|
| AI'nın rolü | Çekirdek — ürün AI üretimi olmadan işlevsiz |
| Kullanılan model | Claude Sonnet (4.6), görsel + metin |
| AI deseni | RAG + ajan benzeri çok adımlı pipeline + kalite döngüsü |
| İnsan katkısı | Referans yükleme, ekran seçimi, son onay/düzenleme |
| Otomasyon seviyesi | Yüksek — keşiften yayına kadar otomatik |
| Tekrarlanabilirlik | Yüksek — aynı girdiyle tutarlı pipeline |
| Üretim hazırlığı | Pilot / iç araç seviyesi (kurumsal dağıtım için sertleştirme gerek) |
| Net iş değeri | Dokümantasyon iş gücünde günler → dakikalar tasarrufu |

**Özet:** DocAgent, AI'yı "yardımcı özellik" olarak değil **ürünün çekirdek
motoru** olarak kullanan, çok adımlı (keşif → bağlam → üretim → doğrulama)
ajansal bir uygulamadır. Olgunluk seviyesi "çalışan pilot / iç araç"
düzeyindedir; teknik mimari sağlam, kurumsal ölçek için sertleştirme
(veritabanı, çok kullanıcı, test kapsamı, maliyet kontrolü) sonraki adımdır.

<!-- TEST: hook doğrulama satırı — bir sonraki commit'te silinecek -->

