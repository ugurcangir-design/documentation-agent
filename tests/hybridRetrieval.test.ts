import { describe, it, expect } from "vitest";
import { chunkText, buildChunkIndex, retrieveChunks, citeKeyOf } from "../src/retrieval/hybridRetrieval";
import type { DocumentSection } from "../src/types/documentSource";

function sec(id: string, sourceType: DocumentSection["sourceType"], title: string, content: string, url?: string): DocumentSection {
  return { id, sourceId: id, sourceType, sourceFile: sourceType === "jira_task" ? "DEMO (Jira)" : `${title}.md`, title, content, ...(url ? { url } : {}) };
}

describe("chunkText — 1200/200 parçalama", () => {
  it("kısa metin tek parça; uzun metin paragraf sınırından bölünür ve örtüşür", () => {
    expect(chunkText("kısa metin")).toEqual(["kısa metin"]);
    const para = "Bu bir paragraf cümlesidir ve biraz uzunca yazılmıştır. ".repeat(12).trim(); // ~670 karakter
    const text = [para, para, para, para].join("\n\n");
    const parts = chunkText(text, 1200, 200);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1200);
    // Paragraf sınırı: parçalar paragraf ortasından değil, cümle/paragraf sonundan kesilir
    expect(parts[0]!.endsWith(".")).toBe(true);
    // Örtüşme: ardışık parçalar ortak metin taşır
    const tail = parts[0]!.slice(-100);
    expect(parts[1]!.includes(tail.slice(-40))).toBe(true);
  });

  it("tek satırlık (HTML'den düzleşmiş) metinde cümle sınırı kullanılır", () => {
    const text = "Kayıt Listesi ekranı tüm kayıtları listeler. ".repeat(60);
    const parts = chunkText(text, 1200, 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.endsWith(".")).toBe(true);
  });
});

describe("retrieveChunks — BM25 + entity gate + tür kotası", () => {
  const relevantConf = sec(
    "confluence_1", "confluence", "Kayıt Listesi Ekranı",
    ("Kayıt Listesi ekranı, sistemde oluşturulmuş tüm kayıtların listelendiği ana inceleme ekranıdır. " +
      "Kullanıcı barkod, bayi id ve oyuncu id filtreleriyle arama yapar; Apply butonu en az bir filtre girilmeden pasiftir. " +
      "Kayıt ID sütunu tıklanınca Kayıt Detay ekranı açılır. ").repeat(6),
    "https://example.atlassian.net/wiki/spaces/X/pages/1"
  );
  const offTargetJira = sec(
    "jira_DEMO-304", "jira_task", "DEMO-304 — [BE] Bayi Modülü Liste Ekranında sortDirection Hatalı Çalışıyor",
    "Tip: Hata\nDurum: Tamam\nBayi listesi sortDirection sortBy sortDirection sortBy bayi bayi bayi sıralama hatalı çalışıyor."
  );
  const onTargetJira = sec(
    "jira_DEMO-40", "jira_task", "DEMO-40 — FE - Kayıt Listesi Ekranı",
    "Tip: Görev\nDurum: Tamam\nKayıt Listesi ekranında filtre paneli, tablo sütunları ve Kayıt Detay yönlendirmesi geliştirilecek."
  );
  const unrelatedBrd = sec("brd_1", "brd", "Bayi Komisyon Kuralları", "Bayi komisyon kuralları ve hesapları. ".repeat(10));
  const all = [relevantConf, offTargetJira, onTargetJira, unrelatedBrd];
  const query = "Kayıt Listesi Kayıt Listesi Kayıt Listesi kayıt listesi Barkod Bayi ID Oyuncu ID Apply filtre arama sıralama sortBy sortDirection";

  it("doğrudan ilgili Confluence sayfası ve ekranı anlatan Jira kaydı seçilir; başka modülün sortDirection kaydı bastırılır", () => {
    const index = buildChunkIndex(all);
    const out = retrieveChunks(index, query, { budget: 6000, entityTokens: ["kayıt", "listesi"], titlePhrase: "Kayıt Listesi" });
    const titles = out.map((c) => c.title);
    expect(titles[0]).toBe("Kayıt Listesi Ekranı"); // Confluence önce (tür sırası + skor)
    expect(titles).toContain("DEMO-40 — FE - Kayıt Listesi Ekranı");
    const off = out.find((c) => c.title.startsWith("DEMO-304"));
    const on = out.find((c) => c.title.startsWith("DEMO-40"));
    if (off) expect(off.score).toBeLessThan(on!.score);
  });

  it("tür kotası ve global bütçe aşılmaz; aynı bölümün parçaları belge sırasıyla birleşir", () => {
    const index = buildChunkIndex(all);
    const budget = 3000;
    const out = retrieveChunks(index, query, { budget, typeCaps: { confluence: 0.5 }, entityTokens: ["kayıt", "listesi"] });
    const total = out.reduce((n, c) => n + c.content.length, 0);
    expect(total).toBeLessThanOrEqual(budget + 200);
    const conf = out.filter((c) => c.sourceType === "confluence").reduce((n, c) => n + c.content.length, 0);
    expect(conf).toBeLessThanOrEqual(Math.floor(budget * 0.5) + 50); // birleştirme ayırıcıları payı
    const c = out.find((x) => x.sourceType === "confluence")!;
    expect(c.citeKey).toBe("Confluence: Kayıt Listesi Ekranı");
    expect(c.url).toContain("atlassian.net");
  });

  it("citeKeyOf: Jira anahtarı, Confluence başlığı, BRD başlığı", () => {
    expect(citeKeyOf({ sourceType: "jira_task", title: "DEMO-40 — FE - Kayıt Listesi", sourceFile: "x" })).toBe("Jira: DEMO-40");
    expect(citeKeyOf({ sourceType: "confluence", title: "Kayıt Listesi Ekranı", sourceFile: "x" })).toBe("Confluence: Kayıt Listesi Ekranı");
    expect(citeKeyOf({ sourceType: "brd", title: "Table Sorting", sourceFile: "x" })).toBe("BRD: Table Sorting");
    expect(citeKeyOf({ sourceType: "process_analysis", title: "7.3 Filtre", sourceFile: "Guide.pdf" })).toBe("Doküman: Guide.pdf § 7.3 Filtre");
  });
});
