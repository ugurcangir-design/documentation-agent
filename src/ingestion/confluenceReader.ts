import axios from "axios";
import { env } from "../config/env";
import {
  getValidAccessToken,
  getConfluenceApiBase,
  getStoredTokens,
} from "../server/auth/atlassianAuth";
import type {
  DocumentSection,
  DocumentSourceType,
} from "../types/documentSource";

interface V2Page {
  id: string;
  title: string;
  body?: { storage?: { value: string } };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Pull every page in a space via the Confluence v2 API, following the
 * cursor-based `_links.next` pagination.
 */
async function fetchAllPages(
  apiBase: string,
  spaceId: string,
  token: string
): Promise<V2Page[]> {
  const pages: V2Page[] = [];
  let nextUrl: string | null =
    `${apiBase}/pages?space-id=${spaceId}&body-format=storage&limit=50`;

  while (nextUrl) {
    const resp: { data: { results: V2Page[]; _links?: { next?: string } } } =
      await axios.get(nextUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    pages.push(...resp.data.results);
    const next = resp.data._links?.next;
    // _links.next is a relative path like /wiki/api/v2/pages?cursor=…
    nextUrl = next ? new URL(next, apiBase.replace(/\/wiki\/api\/v2$/, "")).toString() : null;
    if (pages.length > 500) break; // safety cap
  }
  return pages;
}

export async function readConfluencePages(): Promise<DocumentSection[]> {
  if (!env.confluenceSpaceKey) return [];
  if (!getStoredTokens()) {
    // No OAuth connection — Confluence space scan unavailable.
    // (v1 API + classic token is gone, so there is no fallback.)
    return [];
  }

  try {
    const { accessToken, cloudId } = await getValidAccessToken();
    const apiBase = `${getConfluenceApiBase(cloudId)}/wiki/api/v2`;

    // Resolve space key → numeric space id
    const spaceResp = await axios.get<{ results: Array<{ id: string }> }>(
      `${apiBase}/spaces?keys=${encodeURIComponent(env.confluenceSpaceKey)}&limit=1`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
    );
    const spaceId = spaceResp.data.results[0]?.id;
    if (!spaceId) {
      console.warn(`  Confluence space bulunamadı: ${env.confluenceSpaceKey}`);
      return [];
    }

    const pages = await fetchAllPages(apiBase, spaceId, accessToken);
    console.log(`  Confluence: ${pages.length} sayfa çekildi (space: ${env.confluenceSpaceKey})`);

    return pages.map((page) => ({
      id: `confluence_${page.id}`,
      sourceId: `confluence_${page.id}`,
      sourceType: "confluence" as DocumentSourceType,
      sourceFile: page.title,
      title: page.title,
      content: stripHtml(page.body?.storage?.value ?? ""),
    }));
  } catch (err) {
    console.warn(`  Confluence okuma başarısız: ${(err as Error).message}`);
    return [];
  }
}
