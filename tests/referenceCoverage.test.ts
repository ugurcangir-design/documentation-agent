import { describe, it, expect } from "vitest";
import { computeReferenceCoverage, buildSourcesSection, extractCitationBodies } from "../src/quality/referenceCoverage";
import { buildReferenceBlock, buildReferenceUsageRules } from "../src/generator/referenceBlock";
import type { PreparedChunk } from "../src/retrieval/contextBudget";

const chunks: PreparedChunk[] = [
  { title: "Kayıt Listesi Ekranı", sourceFile: "Kayıt Listesi Ekranı", sourceType: "confluence", content: "Kayıt Listesi ekranı …", score: 9, citeKey: "Confluence: Kayıt Listesi Ekranı", url: "https://example.atlassian.net/wiki/x" },
  { title: "DEMO-40 — FE - Kayıt Listesi Ekranı", sourceFile: "DEMO (Jira)", sourceType: "jira_task", content: "Tip: Görev …", score: 5, citeKey: "Jira: DEMO-40", url: "https://example.atlassian.net/browse/DEMO-40" },
  { title: "Table Sorting", sourceFile: "Kilavuz.md", sourceType: "brd", content: "Sıralama …", score: 3, citeKey: "BRD: Table Sorting" },
];

describe("referenceCoverage — atıf ölçümü", () => {
  it("Kaynak etiketlerini çözer; citeKey, Jira anahtarı ve başlık ile eşler", () => {
    const doc = `## Kayıt Listesi
Apply butonu en az bir filtre girilmeden pasiftir _(Kaynak: Confluence: Kayıt Listesi Ekranı)_.
Filtre paneli URL ile senkronize çalışır (Kaynak: Jira DEMO-40; canlı gözlem).
### Davranış Kuralları ve Özel Durumlar
1. Sıralama … _Kaynak: Canlı gözlem (keşif deneyi); Jira DEMO-18 (…)_`;
    expect(extractCitationBodies(doc).length).toBe(3);
    const cov = computeReferenceCoverage(chunks, doc);
    expect(cov.total).toBe(3);
    expect(cov.cited).toBe(2);
    expect(cov.citedKeys).toEqual(["Confluence: Kayıt Listesi Ekranı", "Jira: DEMO-40"]);
    expect(cov.uncited.map((c) => c.title)).toEqual(["Table Sorting"]);
    expect(cov.byType.confluence).toEqual({ total: 1, cited: 1 });
  });

  it("hiç atıf yoksa 0 ve Kaynaklar bölümü üretilmez", () => {
    const cov = computeReferenceCoverage(chunks, "## Ekran\nSadece görselden anlatım.");
    expect(cov.cited).toBe(0);
    expect(buildSourcesSection(chunks, "## Ekran\nSadece görselden anlatım.")).toBe("");
  });

  it("Kaynaklar bölümü yalnız atıflananları bağlantılı listeler", () => {
    const doc = "Metin _(Kaynak: Jira: DEMO-40)_ ve _(Kaynak: BRD: Table Sorting)_.";
    const sec = buildSourcesSection(chunks, doc);
    expect(sec).toContain("### Kaynaklar");
    expect(sec).toContain("[Jira: DEMO-40 — FE - Kayıt Listesi Ekranı](https://example.atlassian.net/browse/DEMO-40)");
    expect(sec).toContain("- BRD: Table Sorting _(Kilavuz.md)_");
    expect(sec).not.toContain("Confluence: Kayıt Listesi Ekranı");
  });
});

describe("referenceBlock — prompt biçimi", () => {
  it("türe göre gruplar, öncelik sırası Confluence > BRD > Jira, her kaynak [citeKey] başlıklı", () => {
    const block = buildReferenceBlock(chunks, (s) => s);
    const iConf = block.indexOf("### CONFLUENCE DOKÜMANTASYONU");
    const iBrd = block.indexOf("### BRD (İŞ GEREKSİNİMLERİ)");
    const iJira = block.indexOf("### JIRA KAYITLARI");
    expect(iConf).toBeGreaterThanOrEqual(0);
    expect(iConf).toBeLessThan(iBrd);
    expect(iBrd).toBeLessThan(iJira);
    expect(block).toContain("#### [Confluence: Kayıt Listesi Ekranı]");
    expect(block).toContain("#### [Jira: DEMO-40]");
    const rules = buildReferenceUsageRules(chunks);
    expect(rules).toContain("KAYNAK KULLANIMI (ZORUNLU)");
    expect(rules).toContain("[Jira: DEMO-40]");
    expect(buildReferenceBlock([], (s) => s)).toBe("");
    expect(buildReferenceUsageRules([])).toBe("");
  });
});
