import { Endpoint } from "../types/endpoint";

export interface RankedEndpoint {
  score: number;
  endpoint: Endpoint;
}

export function searchEndpoints(
  endpoints: Endpoint[],
  keyword: string
): RankedEndpoint[] {
  const normalizedKeyword = keyword.toLowerCase();

  const ranked: RankedEndpoint[] = [];

  for (const endpoint of endpoints) {
    let score = 0;

    const path = endpoint.path.toLowerCase();

    const summary = (endpoint.summary || "").toLowerCase();

    const tags = (endpoint.tags || []).join(" ").toLowerCase();

    // Path çok önemli
    if (path.includes(normalizedKeyword)) {
      score += 10;
    }

    // Summary önemli
    if (summary.includes(normalizedKeyword)) {
      score += 7;
    }

    // Tag önemli
    if (tags.includes(normalizedKeyword)) {
      score += 5;
    }

    if (score > 0) {
      ranked.push({
        score,
        endpoint,
      });
    }
  }

  return ranked.sort((a, b) => b.score - a.score);
}