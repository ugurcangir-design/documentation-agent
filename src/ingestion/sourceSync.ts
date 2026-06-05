/**
 * Data-source sync — pulls a whole Confluence space or a whole Jira
 * project and materialises the content as references the documentation
 * pipeline already understands.
 *
 *   - A Confluence space  → one ConfluenceRef per page (so each page
 *     flows into retrieval exactly like a manually added page).
 *   - A Jira project      → one JiraRef holding every issue as JSON.
 *
 * Both use the Atlassian OAuth bearer token + cloud id resolved by
 * atlassianAuth. The Confluence v2 REST API is used (v1 is gone — 410).
 */

import fs from "fs";
import path from "path";
import axios from "axios";

import {
  getValidAccessToken,
  getConfluenceApiBase,
  getJiraApiBase,
} from "../server/auth/atlassianAuth";
import { referenceStore } from "../server/store/referenceStore";
import { decodeHtmlEntities } from "../quality/referenceTextCleaner";
import { isExcludedJiraStatus } from "./jiraStatusFilter";

const REFS_DIR = path.join(process.cwd(), "data", "references");

export interface SyncResult {
  count: number;
  log: string[];
}

// ── Confluence ─────────────────────────────────────────────────────

interface V2Space {
  id: string;
  key: string;
  name: string;
}
interface V2Page {
  id: string;
  title: string;
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sync every page of a Confluence space. Each page is stored as a
 * ConfluenceRef, so `referenceStore.getAllConfluence()` (used by the
 * documentation job) immediately sees them.
 */
export async function syncConfluenceSpace(spaceKey: string): Promise<SyncResult> {
  const log: string[] = [];
  const { accessToken, cloudId, siteUrl } = await getValidAccessToken();
  const apiBase = `${getConfluenceApiBase(cloudId)}/wiki/api/v2`;
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  // 1. Resolve space key → space id
  const spaceResp = await axios.get<{ results: V2Space[] }>(
    `${apiBase}/spaces`,
    { headers, params: { keys: spaceKey, limit: 1 } }
  );
  const space = spaceResp.data.results?.[0];
  if (!space) {
    throw new Error(`Confluence space bulunamadı: "${spaceKey}" (key'i kontrol edin)`);
  }

  // 2. Paginate every page in the space
  const dir = path.join(REFS_DIR, "confluence");
  fs.mkdirSync(dir, { recursive: true });

  let cursor: string | null = null;
  let count = 0;
  do {
    const params: Record<string, string | number> = {
      "space-id": space.id,
      limit: 50,
      "body-format": "storage",
    };
    if (cursor) params["cursor"] = cursor;

    const pageResp: { data: { results: V2Page[]; _links?: { next?: string } } } =
      await axios.get(`${apiBase}/pages`, { headers, params });

    const pages = pageResp.data.results ?? [];
    for (const page of pages) {
      const html = page.body?.storage?.value ?? "";
      const text = htmlToText(html);
      if (!text) continue;

      const contentFile = path.join(dir, `${page.id}.txt`);
      fs.writeFileSync(contentFile, text, "utf-8");

      const webui = page._links?.webui ?? "";
      referenceStore.addConfluence({
        url: webui ? `${siteUrl}/wiki${webui}` : `${siteUrl}/wiki/pages/${page.id}`,
        pageId: page.id,
        title: page.title || "(başlıksız)",
        spaceKey,
        contentFile,
        syncedAt: new Date().toISOString(),
        wordCount: text.split(/\s+/).filter(Boolean).length,
      });
      count++;
    }

    const next = pageResp.data._links?.next ?? "";
    cursor = next.includes("cursor=")
      ? decodeURIComponent(next.split("cursor=")[1]!.split("&")[0]!)
      : null;
  } while (cursor);

  log.push(`Confluence [${spaceKey}]: ${count} sayfa senkronize edildi`);
  return { count, log };
}

// ── Jira ───────────────────────────────────────────────────────────

interface JiraIssue {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string };
  };
}

/** Flatten Atlassian Document Format (ADF) description to plain text. */
function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  let out = "";
  if (Array.isArray(n.content)) {
    for (const child of n.content) out += adfToText(child);
    if (["paragraph", "heading", "listItem", "bulletList", "orderedList"].includes(n.type ?? ""))
      out += "\n";
  }
  return out;
}

/**
 * Sync every issue of a Jira project into a single JiraRef (JSON file).
 */
export async function syncJiraProject(projectKey: string): Promise<SyncResult> {
  const log: string[] = [];
  const { accessToken, cloudId } = await getValidAccessToken();
  const apiBase = getJiraApiBase(cloudId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const issues: Array<{
    key: string;
    summary: string;
    status: string;
    type: string;
    priority: string;
    assignee: string;
    description: string;
  }> = [];

  // Henüz başlanmamış / iptal statülerini bağlama almıyoruz (Backlog,
  // To Do, Cancel vb.) — bunlar kararlaştırılmış iş değil. JQL'de status
  // ismiyle filtrelemek, ismin projede bulunmaması durumunda JQL hatası
  // verir; o yüzden sade JQL ile çekip statü ismini normalize ederek
  // post-filter uyguluyoruz (instance bağımsız + isim varyasyonu toleranslı).
  let skippedByStatus = 0;
  let nextPageToken: string | null = null;
  do {
    const body: Record<string, unknown> = {
      jql: `project = "${projectKey}" ORDER BY updated DESC`,
      fields: ["summary", "description", "status", "issuetype", "priority", "assignee"],
      maxResults: 100,
    };
    if (nextPageToken) body["nextPageToken"] = nextPageToken;

    const resp: { data: { issues?: JiraIssue[]; nextPageToken?: string } } =
      await axios.post(`${apiBase}/rest/api/3/search/jql`, body, { headers });

    const batch = resp.data.issues ?? [];
    for (const issue of batch) {
      const f = issue.fields ?? {};
      const statusName = f.status?.name ?? "";
      if (isExcludedJiraStatus(statusName)) {
        skippedByStatus++;
        continue;
      }
      const desc =
        typeof f.description === "string"
          ? f.description
          : adfToText(f.description).trim();
      issues.push({
        key: issue.key,
        summary: f.summary ?? "",
        status: statusName,
        type: f.issuetype?.name ?? "",
        priority: f.priority?.name ?? "",
        assignee: f.assignee?.displayName ?? "",
        description: desc.slice(0, 2000),
      });
    }

    nextPageToken = resp.data.nextPageToken ?? null;
  } while (nextPageToken);

  if (issues.length === 0) {
    if (skippedByStatus > 0) {
      throw new Error(
        `Jira projesi "${projectKey}": ${skippedByStatus} issue bulundu ama tümü ` +
        `Backlog / To Do / Cancel benzeri statülerde olduğu için bağlama alınmadı. ` +
        `Aktif/tamamlanmış statüde issue yok.`
      );
    }
    throw new Error(
      `Jira projesinde issue bulunamadı: "${projectKey}" (key'i ve erişiminizi kontrol edin)`
    );
  }

  const dir = path.join(REFS_DIR, "jira");
  fs.mkdirSync(dir, { recursive: true });
  const contentFile = path.join(dir, `${projectKey}.json`);
  fs.writeFileSync(contentFile, JSON.stringify(issues, null, 2), "utf-8");

  referenceStore.addJira({
    projectKey,
    title: projectKey,
    contentFile,
    syncedAt: new Date().toISOString(),
    issueCount: issues.length,
  });

  log.push(
    `Jira [${projectKey}]: ${issues.length} issue senkronize edildi` +
    (skippedByStatus > 0 ? ` (${skippedByStatus} issue Backlog/To Do/Cancel statüsü nedeniyle atlandı)` : "")
  );
  return { count: issues.length, log };
}
