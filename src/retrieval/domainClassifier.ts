import { Endpoint } from "../types/endpoint";

export interface DomainGroup {
  domain: string;
  endpoints: Endpoint[];
}

export function groupEndpointsByDomain(
  endpoints: Endpoint[]
): DomainGroup[] {
  const groups: Record<string, Endpoint[]> = {};

  for (const endpoint of endpoints) {
    const tag =
      endpoint.tags && endpoint.tags.length > 0
        ? (endpoint.tags[0] ?? "unknown")
        : "unknown";

    if (!groups[tag]) {
      groups[tag] = [];
    }

    (groups[tag] as Endpoint[]).push(endpoint);
  }

  return Object.entries(groups).map(([domain, endpoints]) => ({
    domain,
    endpoints,
  }));
}