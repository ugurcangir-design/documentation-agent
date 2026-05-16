import { Endpoint } from "../types/endpoint";
import { tokenize } from "../quality/confidenceScorer";

export interface RankedEndpoint {
  score: number;
  endpoint: Endpoint;
}

// Heuristic UI-verb → HTTP-method mapping for query intent extraction
const VERB_TO_METHOD: Record<string, string[]> = {
  add: ["POST"], ekle: ["POST"], create: ["POST"], oluştur: ["POST"], yeni: ["POST"],
  list: ["GET"], listele: ["GET"], get: ["GET"], görüntüle: ["GET"], goster: ["GET"], göster: ["GET"],
  update: ["PUT", "PATCH"], güncelle: ["PUT", "PATCH"], edit: ["PUT", "PATCH"], düzenle: ["PUT", "PATCH"], save: ["PUT", "PATCH"],
  delete: ["DELETE"], sil: ["DELETE"], remove: ["DELETE"], kaldır: ["DELETE"],
  search: ["GET"], filter: ["GET"], ara: ["GET"], filtrele: ["GET"],
};

export function searchEndpoints(
  endpoints: Endpoint[],
  keyword: string
): RankedEndpoint[] {
  const tokens = tokenize(keyword);
  if (tokens.length === 0) return [];

  // Methods implied by verbs in the query
  const wantedMethods = new Set<string>();
  for (const t of tokens) {
    for (const m of VERB_TO_METHOD[t] ?? []) wantedMethods.add(m);
  }

  const ranked: RankedEndpoint[] = [];

  for (const endpoint of endpoints) {
    let score = 0;

    const path = endpoint.path.toLowerCase();
    const summary = (endpoint.summary || "").toLowerCase();
    const tags = (endpoint.tags ?? []).join(" ").toLowerCase();
    const method = (endpoint.method || "").toUpperCase();
    const serviceName = (endpoint.serviceName || "").toLowerCase();

    // Token matching, weighted by where the match lands
    for (const t of tokens) {
      if (path.includes(t)) score += 10;
      if (summary.includes(t)) score += 6;
      if (tags.includes(t)) score += 4;
      if (serviceName.includes(t)) score += 2;
    }

    // Method intent boost
    if (wantedMethods.size > 0 && wantedMethods.has(method)) {
      score += 8;
    }

    if (score > 0) ranked.push({ score, endpoint });
  }

  // Dedupe by method+path (same endpoint may be in multiple swagger files)
  const seen = new Set<string>();
  const deduped = ranked
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      const key = `${r.endpoint.method?.toUpperCase()} ${r.endpoint.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return deduped;
}

