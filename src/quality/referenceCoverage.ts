/**
 * Referans kullanım kapsamı (deterministik, 0 token).
 *
 * Kılavuzda `_(Kaynak: Confluence: Sayfa)_`, `(Kaynak: Jira: DEMO-40)` gibi
 * atıf etiketleri aranır; prompt'a verilen her kaynağın (PreparedChunk.citeKey)
 * kılavuzda atıflanıp atıflanmadığı ölçülür. 0 atıf → hedefli fix-up turu
 * (screenProcessor) ve trace uyarısı. Ayrıca kılavuz sonuna deterministik
 * "Kaynaklar" bölümü (ad + bağlantı) üretir — modelden liste İSTENMEZ.
 */
import type { PreparedChunk } from "../retrieval/contextBudget";

export interface ReferenceCoverage {
  total: number;
  cited: number;
  pct: number;
  citedKeys: string[];
  uncited: PreparedChunk[];
  byType: Record<string, { total: number; cited: number }>;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[“”"'`*_]/g, "").replace(/\s+/g, " ").trim();
}

/** Metindeki tüm "Kaynak: …" etiket gövdelerini (normalize) döndürür. */
export function extractCitationBodies(content: string): string[] {
  const out: string[] = [];
  const re = /kaynak\s*:\s*([^\n)]{3,220})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push(norm(m[1]!));
  return out;
}

export function isChunkCited(chunk: PreparedChunk, bodies: string[]): boolean {
  if (bodies.length === 0) return false;
  const key = norm(chunk.citeKey ?? chunk.title);
  const title = norm(chunk.title);
  const jiraKey = /^([a-z][a-z0-9]+-\d+)/.exec(title)?.[1];
  for (const b of bodies) {
    if (b.includes(key)) return true;
    if (jiraKey && new RegExp(`(^|[^a-z0-9-])${jiraKey}(?![0-9])`).test(b)) return true;
    // Başlığın anlamlı kısmı (≥ 12 karakter) etikette geçiyorsa atıf say.
    if (title.length >= 12 && b.includes(title)) return true;
  }
  return false;
}

export function computeReferenceCoverage(chunks: PreparedChunk[], content: string): ReferenceCoverage {
  const bodies = extractCitationBodies(content);
  const byType: Record<string, { total: number; cited: number }> = {};
  const citedKeys: string[] = [];
  const uncited: PreparedChunk[] = [];
  for (const c of chunks) {
    const t = (byType[c.sourceType] ??= { total: 0, cited: 0 });
    t.total++;
    if (isChunkCited(c, bodies)) { t.cited++; citedKeys.push(c.citeKey ?? c.title); }
    else uncited.push(c);
  }
  const total = chunks.length;
  const cited = citedKeys.length;
  return { total, cited, pct: total === 0 ? 0 : Math.round((cited / total) * 100), citedKeys, uncited, byType };
}

const TYPE_LABEL: Record<string, string> = {
  confluence: "Confluence", jira_task: "Jira", brd: "BRD", process_analysis: "Doküman", manual: "Doküman",
};

/**
 * Kılavuz sonuna "### Kaynaklar" bölümü: YALNIZ atıflanan kaynaklar, bağlantı
 * varsa link olarak. Hiç atıf yoksa bölüm üretilmez (boş liste yazılmaz).
 */
export function buildSourcesSection(chunks: PreparedChunk[], content: string): string {
  const bodies = extractCitationBodies(content);
  const cited = chunks.filter((c) => isChunkCited(c, bodies));
  if (cited.length === 0) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of cited) {
    const key = c.citeKey ?? c.title;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = `${TYPE_LABEL[c.sourceType] ?? c.sourceType}: ${c.title.replace(/\s+/g, " ").trim()}`;
    lines.push(c.url ? `- [${label}](${c.url})` : `- ${label}${c.sourceType === "process_analysis" || c.sourceType === "brd" ? ` _(${c.sourceFile})_` : ""}`);
  }
  return `\n\n### Kaynaklar\n\nBu kılavuzda yararlanılan referanslar:\n\n${lines.join("\n")}`;
}
