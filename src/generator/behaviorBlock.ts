/**
 * Faz 4 — davranış kurallarını generator prompt'una yapısal blok olarak sunar.
 * Her kural: kaynak türü (GÖZLEM / GÖZLEM+REFERANS / YALNIZ REFERANS),
 * güvenilirlik, kanıt notu ve atıf. Model bunları kullanıcı diliyle, "Kaynak:"
 * etiketini koruyarak kılavuza işler; yalnız-referans olanı koşullu anlatır.
 */

import type { BehaviorFact } from "../types/behavior";

const SOURCE_LABEL: Record<BehaviorFact["source"], string> = {
  observed: "GÖZLEM",
  both: "GÖZLEM+REFERANS",
  reference: "YALNIZ REFERANS",
};
const CONF_LABEL: Record<BehaviorFact["confidence"], string> = { high: "yüksek", medium: "orta", low: "düşük" };
const TYPE_LABEL: Record<string, string> = {
  brd: "BRD", confluence: "Confluence", jira_task: "Jira", process_analysis: "Süreç Analizi", manual: "Doküman",
};

export function formatBehaviorSource(f: BehaviorFact): string {
  const parts: string[] = [];
  if (f.source !== "reference") parts.push("Canlı gözlem (keşif deneyi)");
  for (const r of f.refs ?? []) {
    const t = TYPE_LABEL[r.type] ?? r.type;
    parts.push(`${t} ${r.id}${r.title && r.title !== r.id ? ` (${r.title.slice(0, 60)})` : ""}`);
  }
  return parts.join("; ");
}

export function buildBehaviorBlock(behaviors: BehaviorFact[]): string {
  if (!behaviors || behaviors.length === 0) return "";
  const lines = behaviors.map((f, i) => {
    const tag = `[${SOURCE_LABEL[f.source]} · ${CONF_LABEL[f.confidence]}${f.conflict ? " · ⚠ ÇELİŞKİ" : ""}]`;
    const ev = f.evidence.note ? ` — Kanıt: ${f.evidence.note}` : "";
    return `${i + 1}. ${tag} ${f.statement}${ev}\n   Kaynak: ${formatBehaviorSource(f)}`;
  });
  return `\n\n# GÖZLEMLENEN DAVRANIŞ KURALLARI (deterministik kanıt — EN GÜVENİLİR; referansla doğrulananlar işaretli)

Bu kurallar gerçek ekranda kontrollü deneylerle (istek parametreleri) ve/veya
referans dokümanlardan elde edildi. HER BİRİNİ kılavuza işle:
- İlgili bölümde (Filtreler ve Arama / Adım Adım / Satır İşlemleri) kullanıcı
  diliyle anlat: ne zaman, ne olur, kullanıcı ne yapmalı.
- "Davranış Kuralları ve Özel Durumlar" bölümünde özetle ve her kuralın sonuna
  _Kaynak: …_ etiketini AYNEN koru.
- [YALNIZ REFERANS] olanı KOŞULLU yaz ("BRD/Jira'ya göre …"); gözlemlenmiş gibi
  sunma. [⚠ ÇELİŞKİ] işaretliyi iki kaynağı da belirterek uyarıyla yaz.
- Burada OLMAYAN bir davranış kuralı UYDURMA.

${lines.join("\n")}`;
}
