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

interface ConfluencePage {
  id: string;
  title: string;
  body: { storage: { value: string } };
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

async function fetchPages(
  baseUrl: string,
  spaceKey: string,
  authHeader: string,
  start = 0,
  limit = 50
): Promise<ConfluencePage[]> {
  const url =
    `${baseUrl}/rest/api/content` +
    `?type=page&spaceKey=${spaceKey}` +
    `&expand=body.storage` +
    `&start=${start}&limit=${limit}`;

  const response = await axios.get<{ results: ConfluencePage[]; size: number }>(url, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });

  const pages = response.data.results;
  if (pages.length === limit) {
    const next = await fetchPages(baseUrl, spaceKey, authHeader, start + limit, limit);
    return [...pages, ...next];
  }
  return pages;
}

export async function readConfluencePages(): Promise<DocumentSection[]> {
  if (!env.confluenceSpaceKey) return [];

  try {
    let baseUrl: string;
    let authHeader: string;

    if (getStoredTokens()) {
      // OAuth path
      const { accessToken, cloudId } = await getValidAccessToken();
      baseUrl = `${getConfluenceApiBase(cloudId)}/wiki`;
      authHeader = `Bearer ${accessToken}`;
    } else if (env.confluenceBaseUrl && env.confluenceEmail && env.confluenceApiToken) {
      // Legacy API token fallback
      baseUrl = `${env.confluenceBaseUrl.replace(/\/$/, "")}/wiki`;
      authHeader =
        "Basic " + Buffer.from(`${env.confluenceEmail}:${env.confluenceApiToken}`).toString("base64");
    } else {
      return [];
    }

    const pages = await fetchPages(baseUrl, env.confluenceSpaceKey, authHeader);
    console.log(`  Confluence: ${pages.length} sayfa çekildi (space: ${env.confluenceSpaceKey})`);

    return pages.map((page) => ({
      id: `confluence_${page.id}`,
      sourceId: `confluence_${page.id}`,
      sourceType: "confluence" as DocumentSourceType,
      sourceFile: page.title,
      title: page.title,
      content: stripHtml(page.body.storage.value),
    }));
  } catch (err) {
    console.warn(`  Confluence okuma başarısız: ${(err as Error).message}`);
    return [];
  }
}
