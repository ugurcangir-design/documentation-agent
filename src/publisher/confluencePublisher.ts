/**
 * Confluence publisher — v2 REST API + OAuth 2.0 bearer.
 *
 * Atlassian removed the v1 REST API (/wiki/rest/api/...) — it now
 * returns HTTP 410 Gone. Everything here uses the v2 API
 * (/wiki/api/v2/...) which requires granular OAuth scopes
 * (read:page:confluence, write:page:confluence, read:space:confluence).
 */

import fs from "fs";
import path from "path";
import FormData from "form-data";
import axios from "axios";

import { env } from "../config/env";
import {
  getValidAccessToken,
  getConfluenceApiBase,
} from "../server/auth/atlassianAuth";
import type { DocumentationOutput } from "../types/documentation";

export type PublishMode = "new" | "append" | "child";

interface V2Page {
  id: string;
  title: string;
  spaceId: string;
  version: { number: number };
  body?: { storage?: { value: string } };
  _links?: { webui?: string };
}

// ── Markdown → Confluence storage format ─────────────────────────
export function markdownToStorage(md: string): string {
  let html = md;

  html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(
    /```(\w+)?\n([\s\S]+?)```/g,
    (_, lang, code) =>
      `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${lang || "text"}</ac:parameter><ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`
  );

  html = html.replace(/^---$/gm, "<hr/>");
  html = convertTables(html);
  html = convertUnorderedLists(html);
  html = convertOrderedLists(html);

  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<")) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return html;
}

function convertTables(md: string): string {
  return md.replace(/((\|.+\|\n)+)/g, (table) => {
    const rows = table.trim().split("\n");
    const headerRow = rows[0];
    if (!headerRow) return table;
    const bodyRows = rows.slice(2);

    const headers = headerRow
      .split("|")
      .filter((_, i, arr) => i > 0 && i < arr.length - 1)
      .map((h) => `<th><p>${h.trim()}</p></th>`)
      .join("");

    const body = bodyRows
      .map((row) => {
        const cells = row
          .split("|")
          .filter((_, i, arr) => i > 0 && i < arr.length - 1)
          .map((c) => `<td><p>${c.trim()}</p></td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("\n");

    return `<table><tbody><tr>${headers}</tr>${body}</tbody></table>`;
  });
}

function convertUnorderedLists(md: string): string {
  return md.replace(/(^- .+\n?)+/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^- /, "").trim()}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });
}

function convertOrderedLists(md: string): string {
  return md.replace(/(^\d+\. .+\n?)+/gm, (block) => {
    const items = block
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^\d+\. /, "").trim()}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  });
}

// ── v2 API helpers ───────────────────────────────────────────────
interface ApiCtx {
  base: string;       // …/wiki/api/v2
  wikiBase: string;   // …/wiki   (for attachments)
  token: string;
}

async function apiContext(): Promise<ApiCtx> {
  const { accessToken, cloudId } = await getValidAccessToken();
  return {
    base: `${getConfluenceApiBase(cloudId)}/wiki/api/v2`,
    wikiBase: `${getConfluenceApiBase(cloudId)}/wiki`,
    token: accessToken,
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Resolve a space key (e.g. "DOCS") to its numeric v2 space id. */
async function getSpaceId(ctx: ApiCtx, spaceKey: string): Promise<string> {
  const res = await axios.get<{ results: Array<{ id: string; key: string }> }>(
    `${ctx.base}/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`,
    { headers: authHeaders(ctx.token) }
  );
  const space = res.data.results[0];
  if (!space) {
    throw new Error(`Confluence space bulunamadı: "${spaceKey}" — Ayarlar'daki Space Key'i kontrol edin.`);
  }
  return space.id;
}

/** Find a page by exact title within a space. */
async function findPage(ctx: ApiCtx, spaceId: string, title: string): Promise<V2Page | null> {
  const res = await axios.get<{ results: V2Page[] }>(
    `${ctx.base}/pages?space-id=${spaceId}&title=${encodeURIComponent(title)}` +
      `&body-format=storage&limit=1`,
    { headers: authHeaders(ctx.token) }
  );
  return res.data.results[0] ?? null;
}

async function createPage(
  ctx: ApiCtx,
  spaceId: string,
  title: string,
  storage: string,
  parentId?: string
): Promise<V2Page> {
  const body = {
    spaceId,
    status: "current",
    title,
    ...(parentId ? { parentId } : {}),
    body: { representation: "storage", value: storage },
  };
  const res = await axios.post<V2Page>(`${ctx.base}/pages`, body, {
    headers: authHeaders(ctx.token),
  });
  return res.data;
}

async function updatePage(
  ctx: ApiCtx,
  page: V2Page,
  storage: string,
  append: boolean
): Promise<V2Page> {
  const finalValue = append
    ? (page.body?.storage?.value ?? "") + "\n" + storage
    : storage;

  const body = {
    id: page.id,
    status: "current",
    title: page.title,
    body: { representation: "storage", value: finalValue },
    version: { number: page.version.number + 1 },
  };
  const res = await axios.put<V2Page>(`${ctx.base}/pages/${page.id}`, body, {
    headers: authHeaders(ctx.token),
  });
  return res.data;
}

/** Attachment upload. v2 has no clean multipart endpoint, so this
 *  still uses the v1 attachment route which Atlassian keeps alive
 *  for attachments. Failure is non-fatal. */
async function uploadScreenshot(
  ctx: ApiCtx,
  pageId: string,
  screenshotPath: string
): Promise<void> {
  const url = `${ctx.wikiBase}/rest/api/content/${pageId}/child/attachment`;
  const fileName = path.basename(screenshotPath);
  const buffer = fs.readFileSync(screenshotPath);

  const form = new FormData();
  form.append("file", buffer, { filename: fileName, contentType: "image/png" });
  form.append("minorEdit", "true");

  await axios.post(url, form, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "X-Atlassian-Token": "no-check",
      ...form.getHeaders(),
    },
  });
}

// ── Public API ───────────────────────────────────────────────────
export async function publishToConfluence(
  output: DocumentationOutput,
  mode: PublishMode = "new"
): Promise<{ userManualUrl: string }> {
  if (!env.confluenceSpaceKey) {
    throw new Error("Confluence Space Key ayarlanmamış (Ayarlar sayfası).");
  }

  const ctx = await apiContext();
  const spaceId = await getSpaceId(ctx, env.confluenceSpaceKey);
  const parentId = env.confluenceParentPageId || undefined;

  const userManualTitle = `${output.appTitle} — Kullanıcı Kılavuzu`;
  const userManualStorage = markdownToStorage(output.userManual);

  let umPage: V2Page;

  if (mode === "child") {
    // Always create a new child page under parentId
    umPage = await createPage(ctx, spaceId, userManualTitle, userManualStorage, parentId);
  } else {
    // 'new' (create or replace) and 'append' both look up the existing page
    const existingUm = await findPage(ctx, spaceId, userManualTitle);
    const append = mode === "append";

    umPage = existingUm
      ? await updatePage(ctx, existingUm, userManualStorage, append)
      : await createPage(ctx, spaceId, userManualTitle, userManualStorage, parentId);
  }

  // Upload screenshots as attachments (non-fatal on failure)
  for (const screenDoc of output.screens) {
    if (screenDoc.screen?.screenshotPath && fs.existsSync(screenDoc.screen.screenshotPath)) {
      try {
        await uploadScreenshot(ctx, umPage.id, screenDoc.screen.screenshotPath);
      } catch (err) {
        console.warn(`  Screenshot upload skip: ${(err as Error).message}`);
      }
    }
  }

  const umUrl = `${ctx.wikiBase}${umPage._links?.webui ?? ""}`;
  console.log(`  User manual → ${umUrl}`);

  return { userManualUrl: umUrl };
}

/** Search pages by title fragment — used by the publish modal. */
export async function searchConfluencePages(
  query: string
): Promise<Array<{ id: string; title: string; url: string }>> {
  const ctx = await apiContext();
  // v2 page list supports a title filter; for a fragment search we
  // pull a page batch and filter client-side.
  const res = await axios.get<{ results: V2Page[] }>(
    `${ctx.base}/pages?limit=100`,
    { headers: authHeaders(ctx.token) }
  );
  const q = query.toLowerCase();
  return res.data.results
    .filter((p) => p.title.toLowerCase().includes(q))
    .slice(0, 20)
    .map((p) => ({
      id: p.id,
      title: p.title,
      url: `${ctx.wikiBase}${p._links?.webui ?? ""}`,
    }));
}
