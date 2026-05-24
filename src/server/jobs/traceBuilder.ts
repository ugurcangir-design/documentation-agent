/**
 * Doküman footer'ında görünen "Üretim Bilgisi" izini oluşturur.
 * Hangi referanslar, kaç endpoint, kapsam %'si, fix-up sayısı,
 * truncation uyarısı vb. tek yerden formatlanır.
 */

import type { ScreenContext } from "../../types/documentation";
import type { CoverageReport } from "../../quality/coverageCheck";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  brd: "BRD",
  confluence: "Confluence",
  jira_task: "Jira",
  process_analysis: "Süreç Analizi",
  manual: "Manuel",
};

export interface TraceInputs {
  context: ScreenContext;
  coverage: CoverageReport;
  fixUpAdded: number;
  truncated: boolean;
  usedTemplates: string[];
  stateCount: number;
}

export function buildTrace(t: TraceInputs): string {
  const { context, coverage, fixUpAdded, truncated, usedTemplates, stateCount } = t;

  const chunkTypeBreakdown = Object.entries(
    context.preparedChunks.reduce<Record<string, number>>((acc, c) => {
      acc[c.sourceType] = (acc[c.sourceType] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([type, n]) => `${SOURCE_TYPE_LABELS[type] ?? type} ${n}`)
    .join(", ");

  const lines: string[] = [
    `\n\n---`,
    `### Üretim Bilgisi`,
    `Bu döküman aşağıdaki kaynaklarla üretildi:`,
    `- **Referans bölümleri** (${context.preparedChunks.length}${chunkTypeBreakdown ? ` — ${chunkTypeBreakdown}` : ""}): ${context.preparedChunks.map((c) => c.title).slice(0, 8).join(", ") || "(yok)"}`,
    `- **API endpoint** (${context.relatedEndpoints.length}): ${context.relatedEndpoints.slice(0, 5).map((e) => `\`${e.endpoint.method} ${e.endpoint.path}\``).join(", ") || "(yok)"}`,
    `- **Şablon** (${usedTemplates.length}): ${usedTemplates.join(", ") || "(yok)"}`,
    `- **Ekran state** (${stateCount + 1}): 1 ana + ${stateCount} test user simülasyon görüntüsü`,
    `- **UI öğesi kapsamı**: ${coverage.coveragePct}% (${coverage.coveredElements}/${coverage.totalElements})` +
      (coverage.missing.length > 0
        ? ` · _Eksik: ${coverage.missing.slice(0, 5).join(", ")}${coverage.missing.length > 5 ? "…" : ""}_`
        : ""),
  ];

  if (fixUpAdded > 0) {
    lines.push(`- **Kapsam fix-up**: ${fixUpAdded} eksik öğe için ikinci tur uygulandı`);
  }
  if (truncated) {
    lines.push(`- ⚠️ **Çıktı kesildi** (\`max_tokens\` limitine takıldı) — Ayarlar > Sistem Promptları'ndan \`maxTokens\` değerini artırın`);
  }
  lines.push(`- **Üretim**: ${new Date().toLocaleString("tr-TR")}`);

  return lines.join("\n");
}
