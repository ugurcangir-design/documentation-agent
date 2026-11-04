/**
 * Hybrid retrieval — Analyst Studio ile aynı tasarım, DocAgent'a uyarlandı:
 *
 *   1. Her referans bölümü (Confluence sayfası, BRD bölümü, Jira issue,
 *      yüklenen doküman) 1200 karakterlik, 200 örtüşmeli PARÇALARA bölünür
 *      (paragraf / satır / cümle sınırına çekilerek). Eskiden bir Confluence
 *      sayfası (26-100KB) TEK bölümdü ve yalnız ilk 2.6KB'si prompt'a giriyordu.
 *   2. Tüm parçalar tek bir BM25 indeksinde puanlanır (k1=1.5, b=0.75; Türkçe
 *      ek toleransı için 7-karakter prefix stemming). Eskiden ham kelime
 *      sayımı kısa Jira kayıtlarını (çok "sortDirection") büyük ve doğrudan
 *      ilgili sayfaların önüne geçiriyordu.
 *   3. Ekranın BİRİNCİL VARLIĞI (başlık/path token'ları) ile "entity gate":
 *      başlıkta ekran adı geçen parça güçlü boost alır; ekranla hiç ilgisi
 *      olmayan (varlık token'ı geçmeyen) Jira parçaları bastırılır → Retailer
 *      modülü hataları liste ekranı kılavuzuna sızmaz.
 *   4. Skor sırasıyla AÇGÖZLÜ seçim: tür başına kota (bütçe oranı) + global
 *      bütçe + bölüm başına parça sınırı. Kotası dolan tür ATLANIR, durulmaz.
 *   5. Aynı bölümün parçaları belge sırasına dizilip birleştirilir; her
 *      kaynak bir ATIF ANAHTARI (citeKey) taşır → prompt başlığı + kılavuz atfı.
 *
 * Token maliyeti yok (deterministik). İndeks job başına bir kez kurulur.
 */
import type { DocumentSection, DocumentSourceType } from "../types/documentSource";
import { tokenize } from "../quality/confidenceScorer";
import type { PreparedChunk } from "./contextBudget";

export interface RefChunk {
  id: string;
  sectionId: string;
  sourceId: string;
  sourceType: DocumentSourceType;
  sourceFile: string;
  title: string;
  url?: string;
  /** Bölüm içindeki parça sırası (birleştirirken belge sırası korunur). */
  order: number;
  text: string;
}

export interface ChunkIndex {
  chunks: RefChunk[];
  /** Parça başına terim frekansı. */
  tf: Array<Map<string, number>>;
  /** Terim → kaç parçada geçiyor. */
  df: Map<string, number>;
  len: number[];
  avgLen: number;
}

/** Türkçe ek toleransı: uzun token'lar 7 karaktere kırpılır
 *  (filtreleme / filtreler / filtrenin → "filtrel"). */
export function stem(t: string): string {
  return t.length > 7 ? t.slice(0, 7) : t;
}

export function bmTokens(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * 1200/200 parçalama. Kesme noktası, parçanın ikinci yarısındaki son
 * paragraf (\n\n) → satır (\n) → cümle sonu (". ") sınırına çekilir; yoksa
 * sert kesilir. Tek satırlık (HTML'den düzleştirilmiş) sayfalarda cümle
 * sınırı devreye girer.
 */
export function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const src = (text || "").replace(/\r\n/g, "\n");
  const n = src.length;
  if (n === 0) return [];
  if (n <= size) return [src.trim()].filter(Boolean);
  const out: string[] = [];
  let start = 0;
  const half = Math.floor(size / 2);
  while (start < n) {
    let end = Math.min(n, start + size);
    if (end < n) {
      const win = src.slice(start + half, end);
      const para = win.lastIndexOf("\n\n");
      const line = win.lastIndexOf("\n");
      const sent = Math.max(win.lastIndexOf(". "), win.lastIndexOf("? "), win.lastIndexOf("! "), win.lastIndexOf(".\t"));
      if (para > 0) end = start + half + para + 2;
      else if (line > 0) end = start + half + line + 1;
      else if (sent > 0) end = start + half + sent + 2;
    }
    const piece = src.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= n) break;
    start = Math.max(end - overlap, start + half);
  }
  return out;
}

export function buildChunkIndex(sections: DocumentSection[], size = 1200, overlap = 200): ChunkIndex {
  const chunks: RefChunk[] = [];
  for (const s of sections) {
    const parts = chunkText(s.content, size, overlap);
    parts.forEach((text, i) => {
      chunks.push({
        id: `${s.id}#${i}`,
        sectionId: s.id,
        sourceId: s.sourceId,
        sourceType: s.sourceType,
        sourceFile: s.sourceFile,
        title: s.title,
        ...(s.url ? { url: s.url } : {}),
        order: i,
        text,
      });
    });
  }
  const tf: Array<Map<string, number>> = [];
  const df = new Map<string, number>();
  const len: number[] = [];
  let total = 0;
  for (const c of chunks) {
    // Başlık iki kez: başlık eşleşmesi içerikten daha ayırt edici.
    const toks = [...bmTokens(c.title), ...bmTokens(c.title), ...bmTokens(c.text)];
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
    total += toks.length;
  }
  return { chunks, tf, df, len, avgLen: chunks.length > 0 ? total / chunks.length : 1 };
}

/** BM25 puanları; sorgudaki tekrar (qtf, maks 3) boost olarak kullanılır —
 *  Analyst Studio'nun "anahtar kelimeyi 5× tekrarla" boost'unun karşılığı. */
export function bm25Scores(index: ChunkIndex, query: string, k1 = 1.5, b = 0.75): Float64Array {
  const N = index.chunks.length;
  const scores = new Float64Array(N);
  if (N === 0) return scores;
  const q = new Map<string, number>();
  for (const t of bmTokens(query)) q.set(t, (q.get(t) ?? 0) + 1);
  for (const [t, qtfRaw] of q) {
    const dfT = index.df.get(t);
    if (!dfT) continue;
    const idf = Math.log(1 + (N - dfT + 0.5) / (dfT + 0.5));
    const qtf = Math.min(qtfRaw, 3);
    for (let i = 0; i < N; i++) {
      const f = index.tf[i]!.get(t);
      if (!f) continue;
      const norm = 1 - b + b * (index.len[i]! / index.avgLen);
      scores[i] = (scores[i] ?? 0) + idf * ((f * (k1 + 1)) / (f + k1 * norm)) * qtf;
    }
  }
  return scores;
}

export interface RetrieveOptions {
  /** Toplam karakter bütçesi (tüm türler). */
  budget: number;
  /** Tür başına bütçe ORANI (0-1). Verilmeyen tür için 0.35. */
  typeCaps?: Partial<Record<DocumentSourceType, number>>;
  /** Ekranın birincil varlık token'ları (başlık + path) — entity gate. */
  entityTokens?: string[];
  /** Ekran başlığı ifadesi (küçük harf) — başlıkta geçen kaynak boost. */
  titlePhrase?: string;
  /** Bölüm başına en çok parça (çeşitlilik). */
  maxPerSection?: number;
}

export const DEFAULT_TYPE_CAPS: Record<DocumentSourceType, number> = {
  confluence: 0.45,
  brd: 0.35,
  // Yüklenen süreç dokümanı çoğu zaman BAŞKA ürünün kılavuzudur (ör. Trade
  // Panel) — ekranla ilgili olmayan "ticket" bölümleri sızmasın diye dar kota.
  process_analysis: 0.2,
  jira_task: 0.3,
  manual: 0.15,
};
/** Bu uzunluğun altındaki parça (tek satırlık madde) bağlam taşımaz. */
const MIN_CHUNK_LEN = 120;

/** Kılavuzdaki atıf anahtarı — prompt başlığında `[…]` içinde verilir ve
 *  modelden `_(Kaynak: …)_` olarak AYNEN istenir. */
export function citeKeyOf(c: { sourceType: DocumentSourceType; title: string; sourceFile: string }): string {
  const t = c.title.replace(/\s+/g, " ").trim();
  switch (c.sourceType) {
    case "confluence": return `Confluence: ${t}`;
    case "jira_task": {
      const m = /^([A-Z][A-Z0-9]+-\d+)/.exec(t);
      return `Jira: ${m ? m[1] : t}`;
    }
    case "brd": return `BRD: ${t}`;
    case "process_analysis": return `Doküman: ${c.sourceFile} § ${t}`;
    default: return `Doküman: ${t}`;
  }
}

const TYPE_ORDER: DocumentSourceType[] = ["confluence", "brd", "process_analysis", "jira_task", "manual"];

export function retrieveChunks(index: ChunkIndex, query: string, opts: RetrieveOptions): PreparedChunk[] {
  const { budget } = opts;
  const caps = { ...DEFAULT_TYPE_CAPS, ...(opts.typeCaps ?? {}) };
  const maxPerSection = opts.maxPerSection ?? 6;
  const entity = (opts.entityTokens ?? []).map(stem).filter((t) => t.length >= 3);
  const phrase = (opts.titlePhrase ?? "").toLowerCase().trim();

  const raw = bm25Scores(index, query);
  const scored: Array<{ i: number; s: number }> = [];
  for (let i = 0; i < index.chunks.length; i++) {
    let s = raw[i]!;
    if (s <= 0) continue;
    const c = index.chunks[i]!;
    const titleLc = c.title.toLowerCase();
    const textToks = new Set(bmTokens(c.text));
    const titleToks = new Set(bmTokens(c.title));
    const entInTitle = entity.some((t) => titleToks.has(t));
    const entInText = entity.some((t) => textToks.has(t));
    if (phrase && titleLc.includes(phrase)) s *= 1.6;
    else if (entInTitle) s *= 1.25;
    if (c.text.length < MIN_CHUNK_LEN) continue;
    if (entity.length > 0 && !entInTitle && !entInText) {
      // Ekranın varlığı hiç geçmiyor: Jira'da büyük olasılıkla başka modülün
      // kaydı (bastır); diğer türlerde de ciddi ceza (başka ürünün bölümü
      // olabilir) — genel kurallar yine de düşük skorla girebilir.
      s *= c.sourceType === "jira_task" ? 0.35 : 0.5;
    }
    scored.push({ i, s });
  }
  scored.sort((a, b) => b.s - a.s);

  const used: Partial<Record<DocumentSourceType, number>> = {};
  const perSection = new Map<string, number>();
  const picked = new Map<string, { chunks: RefChunk[]; score: number }>();
  let total = 0;
  for (const { i, s } of scored) {
    if (budget - total < 200) break;
    const c = index.chunks[i]!;
    const clen = c.text.length;
    const cap = Math.floor(budget * (caps[c.sourceType] ?? 0.35));
    if ((used[c.sourceType] ?? 0) + clen > cap) continue;
    if ((perSection.get(c.sectionId) ?? 0) >= maxPerSection) continue;
    if (total + clen > budget) continue;
    used[c.sourceType] = (used[c.sourceType] ?? 0) + clen;
    perSection.set(c.sectionId, (perSection.get(c.sectionId) ?? 0) + 1);
    total += clen;
    const p = picked.get(c.sectionId);
    if (p) { p.chunks.push(c); p.score = Math.max(p.score, s); }
    else picked.set(c.sectionId, { chunks: [c], score: s });
  }

  const out: PreparedChunk[] = [];
  for (const { chunks, score } of picked.values()) {
    chunks.sort((a, b) => a.order - b.order);
    const first = chunks[0]!;
    const content = chunks.map((c) => c.text).join("\n\n[…]\n\n");
    out.push({
      title: first.title,
      sourceFile: first.sourceFile,
      sourceType: first.sourceType,
      content,
      score: Math.round(score * 100) / 100,
      sourceId: first.sourceId,
      sectionId: first.sectionId,
      citeKey: citeKeyOf(first),
      ...(first.url ? { url: first.url } : {}),
    });
  }
  // Kaynak türü öncelik sırası (Confluence > BRD > süreç > Jira > diğer),
  // tür içinde skor.
  out.sort((a, b) => {
    const ta = TYPE_ORDER.indexOf(a.sourceType as DocumentSourceType);
    const tb = TYPE_ORDER.indexOf(b.sourceType as DocumentSourceType);
    return (ta === tb) ? b.score - a.score : ta - tb;
  });
  return out;
}

/** İndeks önbelleği — aynı bölüm dizisi (job başına bir kez yüklenir) için
 *  BM25 indeksi bir kez kurulur. */
const INDEX_CACHE = new WeakMap<DocumentSection[], ChunkIndex>();
export function getChunkIndex(sections: DocumentSection[]): ChunkIndex {
  let idx = INDEX_CACHE.get(sections);
  if (!idx) {
    idx = buildChunkIndex(sections);
    INDEX_CACHE.set(sections, idx);
  }
  return idx;
}
