# Plan: Davranış Keşfi ve Kanıta Dayalı Kılavuz

Hedef: DocAgent, kılavuz yazarken **ekranın davranış kurallarını** (örn. *"Ticket ID
ile arama yapıldığında diğer filtreler isteğe dahil edilmez"*) canlı gözlemden ve
referanslardan **kanıtla** bulup kılavuza **kaynak atfıyla** dahil etsin.

## Kök tespit
| Kanıt yolu | Boşluk |
|---|---|
| Canlı gözlem | Heuristik keşif hiç network yakalamıyordu (yalnız görsel). |
| Referanslar | RAG bölüm getirir; kural çıkarımı ve gözlemle çapraz doğrulama yoktu. |
| Ekran analizi | `ScreenState`/`ScreenAnalysis`'te davranış/kural alanı yoktu. |

İlkeler: kanıt önce **deterministik** (Playwright network/DOM, 0 token); LLM yalnız
yorum/çapraz doğrulama; CLI modunda kalınır; mevcut akış bozulmaz (alanlar opsiyonel);
her kural **kaynak + güvenilirlik** taşır; **uydurma yasak** korunur.

## Fazlar
- **Faz 0 — Kanıt veri modeli:** `ScreenState.evidence`, `BehaviorFact`, `DiscoveredScreen.behaviors`.
- **Faz 1 — Deterministik network yakalama:** keşifte her etkileşimin tetiklediği
  aynı-origin XHR/fetch isteği state'e bağlanır (query/body anahtarları, PII maskeli).
- **Faz 2 — Davranış deneyleri (`behaviorProbes.ts`):** filtre formlarında kontrollü
  okuma-submit deneyleri (tek filtre / A+B / boş / temizle / sıralama) → istek diff'i →
  `BehaviorFact` (filter-precedence, filter-combine, required-field, sort, pagination…).
- **Faz 3 — Referans kural çıkarımı + çapraz doğrulama:** `ruleExtractor.ts`
  (-malı/-meli, dikkate alınmaz, zorunlu, kabul kriteri…), `behaviorCrossCheck.ts`
  (gözlem × referans → `source: observed|reference|both`, çelişki işareti, atıf).
- **Faz 4 — Generator:** yapısal "GÖZLEMLENEN DAVRANIŞ KURALLARI" bloğu, çıktı yapısına
  "### Davranış Kuralları ve Özel Durumlar", kaynak etiketi, trace sayaçları.
- **Faz 5 — Davranış kapsamı:** UI-öğesi kapsamına ek ikinci eksen; eksik kural
  fix-up hedefi; metin tabanlı judge (görsel değil).
- **Faz 6 — İkincil:** alan semantiği (zorunlu/format → "Alanlar" tablosu), detay ekranı
  ayrı doküman, geçersiz-değer doğrulama probe'u, hybrid retrieval, atıf standardı.

## Doğrulama
Her faz: tsc + vitest; deterministik modüller için birim testleri; keşif tarafı için
yerel HTML fikstürlü Playwright entegrasyon testi (canlı uygulamaya bağımlı değil).
Uçtan uca: Ticket Explorer → yalnız ID vs ID+Retailer isteği diff'i → kural kılavuzda.

## Durum (2026-11-04)
- ✅ Faz 0 — kanıt veri modeli
- ✅ Faz 1 — deterministik network yakalama (entegrasyon testi: dolu arama isteği kanıtı)
- ✅ Faz 2 — davranış deneyleri + çıkarım (kullanıcının kuralı türetildi: filter-precedence/high)
- ✅ Faz 3 — referans kural çıkarımı + tür-farkında çapraz doğrulama (both / conflict / reference-only)
- ✅ Faz 4 — generator bloğu + '### Davranış Kuralları ve Özel Durumlar' + trace
- ✅ Faz 5 — davranış kapsamı + hedefli fix-up + trace
- ✅ Faz 6a — alan semantiği (domFacts → 'ALAN ÖZELLİKLERİ')  ✅ Faz 6b — geçersiz-değer doğrulama probe'u
- ✅ Canlı doğrulama (2026-11-04, UAT liste ekranı): 12 keşif turu sonunda 7 kural / 0 yanlış
  pozitif — Apply bulucu (pasif dahil), tüm filtre temizliği, tablodan gerçek deney değeri,
  pozitif-kanıt ilkesi, her-origin XHR yakalama + denylist.
- ✅ Faz 6d — hibrit retrieval (BM25 + 1200/200 parça + entity gate + tür kotası)  ✅ Faz 6e — atıf standardı (`_(Kaynak: …)_` + Kaynaklar bölümü + referans kapsamı/fix-up)
- ⏳ Faz 6c — detay ekranı ayrı doküman
- Canlı doğrulama: Chrome MCP ile UAT Ticket Explorer (oturum açıldığında).
