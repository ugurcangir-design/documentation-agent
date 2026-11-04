import { describe, it, expect } from "vitest";
import { extractReferenceRules, isRuleLike } from "../src/retrieval/ruleExtractor";
import { crossCheckBehaviors } from "../src/quality/behaviorCrossCheck";
import type { DocumentSection } from "../src/types/documentSource";
import type { BehaviorFact } from "../src/types/behavior";

const sec = (title: string, content: string, sourceType: DocumentSection["sourceType"] = "jira_task"): DocumentSection =>
  ({ id: title, sourceId: "jira_MBSOPS", sourceType, sourceFile: "MBSOPS (Jira)", title, content });

describe("ruleExtractor (Faz 3)", () => {
  it("kural kalıplı cümleleri çıkarır, anlatı cümlelerini atlar; Jira anahtarını refId yapar", () => {
    const rules = extractReferenceRules([
      sec("MBSOPS-251 — Ticket Explorer filtreleri",
        "Ekranda ticket listesi görüntülenir. Ticket ID ile arama yapıldığında diğer filtreler dikkate alınmaz ve yalnızca ID'ye göre sorgu atılır.\nSayfa boyutu varsayılan 20 olmalıdır.\nBu ekran operasyon ekibi tarafından kullanılır."),
    ]);
    expect(rules.length).toBe(2);
    expect(rules[0]!.refId).toBe("MBSOPS-251");
    expect(rules.some((r) => /dikkate alınmaz/.test(r.text))).toBe(true);
    expect(rules.some((r) => /kullanılır/.test(r.text))).toBe(false);
    expect(isRuleLike("Kayıtlar tabloda listelenir.")).toBe(false);
  });
});

describe("crossCheckBehaviors (Faz 3)", () => {
  const observed: BehaviorFact = {
    id: "bf1", screenPath: "/ticket-explorer", kind: "filter-precedence",
    statement: '"Ticket ID" alanı doluyken "Retailer ID" filtresi isteğe dahil edilmez — Ticket ID ile arama diğer filtreyi geçersiz kılar.',
    evidence: { requests: [{ method: "GET", path: "/api/tickets", query: { ticketId: "533", page: "0" } }] },
    source: "observed", confidence: "high",
  };

  it("gözlemi eşleşen Jira kuralıyla doğrular → source both + ref", () => {
    const rules = extractReferenceRules([
      sec("MBSOPS-251 — Ticket Explorer", "Ticket ID ile arama yapıldığında diğer filtreler dikkate alınmaz ve yalnızca ID'ye göre sorgu atılır."),
      sec("MBSOPS-999 — Alakasız", "Kupon iptal işlemi 24 saat içinde yapılmalıdır."),
    ]);
    const out = crossCheckBehaviors([observed], rules, "Ticket Explorer ticket retailer player filtre arama");
    const f = out.find((x) => x.id === "bf1")!;
    expect(f.source).toBe("both");
    expect(f.refs?.[0]?.id).toBe("MBSOPS-251");
    expect(f.conflict).toBeUndefined();
    // alakasız kural ne eşleşmeli ne de yalnız-referans olarak eklenmeli
    expect(out.some((x) => /Kupon iptal/.test(x.statement))).toBe(false);
  });

  it("referans açıkça 'birlikte uygulanır' derken gözlem öncelik diyorsa conflict işaretler", () => {
    const rules = extractReferenceRules([
      sec("BRD-1", "Ticket ID ve Retailer ID filtreleri birlikte uygulanmalıdır; tüm filtreler sorguya dahil edilir.", "brd"),
    ]);
    const out = crossCheckBehaviors([observed], rules, "ticket retailer filtre arama");
    expect(out[0]!.conflict).toBe(true);
  });

  it("ekranla ilgili ama gözlenmemiş kuralı 'reference' kaynaklı, medium ekler", () => {
    const rules = extractReferenceRules([
      sec("MBSOPS-300 — Ticket arama", "Ticket arama ekranında tarih aralığı filtresi zorunludur; tarih girilmeden arama yapılamaz."),
    ]);
    const out = crossCheckBehaviors([observed], rules, "Ticket Explorer ticket arama filtre tarih");
    const ref = out.find((x) => x.source === "reference");
    expect(ref).toBeTruthy();
    expect(ref!.kind).toBe("required-field");
    expect(ref!.confidence).toBe("medium");
    expect(ref!.refs?.[0]?.id).toBe("MBSOPS-300");
  });
});
