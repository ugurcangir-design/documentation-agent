import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";

import { env } from "../config/env";
import type { DocumentationOutput } from "../types/documentation";

export type PublishMode = "new" | "append" | "child";

interface ConfluencePage {
  id: string;
  title: string;
  version: { number: number };
  body?: { storage: { value: string } };
  _links: { webui: string };
}

function getAuthHeader(): string {
  return (
    "Basic " +
    Buffer.from(
      `${env.confluenceEmail}:${env.confluenceApiToken}`
    ).toString("base64")
  );
}

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

async function getPage(
  baseUrl: string,
  authHeader: string,
  title: string
): Promise<ConfluencePage | null> {
  const url =
    `${baseUrl}/wiki/rest/api/content` +
    `?title=${encodeURIComponent(title)}&spaceKey=${env.confluenceSpaceKey}` +
    `&expand=version,body.storage`;

  const res = await axios.get<{ results: ConfluencePage[] }>(url, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });

  return res.data.results[0] ?? null;
}

async function createPage(
  baseUrl: string,
  authHeader: string,
  title: string,
  content: string,
  parentId?: string
): Promise<ConfluencePage> {
  const body = {
    type: "page",
    title,
    space: { key: env.confluenceSpaceKey },
    ...(parentId ? { ancestors: [{ id: parentId }] } : {}),
    body: { storage: { value: content, representation: "storage" } },
  };

  const res = await axios.post<ConfluencePage>(
    `${baseUrl}/wiki/rest/api/content`,
    body,
    {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}

async function updatePage(
  baseUrl: string,
  authHeader: string,
  page: ConfluencePage,
  newContent: string,
  append: boolean
): Promise<ConfluencePage> {
  const content = append
    ? (page.body?.storage.value ?? "") + "\n" + newContent
    : newContent;

  const body = {
    type: "page",
    title: page.title,
    space: { key: env.confluenceSpaceKey },
    version: { number: page.version.number + 1 },
    body: { storage: { value: content, representation: "storage" } },
  };

  const res = await axios.put<ConfluencePage>(
    `${baseUrl}/wiki/rest/api/content/${page.id}`,
    body,
    {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}

async function uploadScreenshot(
  baseUrl: string,
  authHeader: string,
  pageId: string,
  screenshotPath: string
): Promise<void> {
  const url = `${baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
  const fileName = path.basename(screenshotPath);
  const buffer = fs.readFileSync(screenshotPath);

  const form = new FormData();
  form.append("file", buffer, { filename: fileName, contentType: "image/png" });
  form.append("minorEdit", "true");

  await axios.post(url, form, {
    headers: {
      Authorization: authHeader,
      "X-Atlassian-Token": "no-check",
      ...form.getHeaders(),
    },
  });
}

export async function publishToConfluence(
  output: DocumentationOutput,
  mode: PublishMode = "new"
): Promise<void> {
  if (!env.confluenceBaseUrl || !env.confluenceSpaceKey) {
    console.log("  Confluence not configured — skipping");
    return;
  }

  const baseUrl = env.confluenceBaseUrl.replace(/\/$/, "");
  const authHeader = getAuthHeader();
  const parentId = env.confluenceParentPageId || undefined;

  const userManualTitle = `${output.appTitle} — Kullanıcı Kılavuzu`;
  const technicalDocTitle = `${output.appTitle} — Teknik Döküman`;
  const userManualStorage = markdownToStorage(output.userManual);
  const technicalDocStorage = markdownToStorage(output.technicalDoc);

  let userManualPage: ConfluencePage;
  let technicalDocPage: ConfluencePage;

  if (mode === "append") {
    // Append content to existing pages if they exist
    const existingManual = await getPage(baseUrl, authHeader, userManualTitle);
    const existingTechnical = await getPage(baseUrl, authHeader, technicalDocTitle);

    userManualPage = existingManual
      ? await updatePage(baseUrl, authHeader, existingManual, userManualStorage, true)
      : await createPage(baseUrl, authHeader, userManualTitle, userManualStorage, parentId);

    technicalDocPage = existingTechnical
      ? await updatePage(baseUrl, authHeader, existingTechnical, technicalDocStorage, true)
      : await createPage(baseUrl, authHeader, technicalDocTitle, technicalDocStorage, parentId);
  } else if (mode === "child") {
    // Create as child page under parentId
    userManualPage = await createPage(
      baseUrl, authHeader, userManualTitle, userManualStorage, parentId
    );
    technicalDocPage = await createPage(
      baseUrl, authHeader, technicalDocTitle, technicalDocStorage, parentId
    );
  } else {
    // new — create or replace
    const existingManual = await getPage(baseUrl, authHeader, userManualTitle);
    const existingTechnical = await getPage(baseUrl, authHeader, technicalDocTitle);

    userManualPage = existingManual
      ? await updatePage(baseUrl, authHeader, existingManual, userManualStorage, false)
      : await createPage(baseUrl, authHeader, userManualTitle, userManualStorage, parentId);

    technicalDocPage = existingTechnical
      ? await updatePage(baseUrl, authHeader, existingTechnical, technicalDocStorage, false)
      : await createPage(baseUrl, authHeader, technicalDocTitle, technicalDocStorage, parentId);
  }

  console.log(`  User manual → ${baseUrl}${userManualPage._links?.webui ?? ""}`);
  console.log(`  Technical doc → ${baseUrl}${technicalDocPage._links?.webui ?? ""}`);

  for (const screenDoc of output.screens) {
    if (fs.existsSync(screenDoc.screen.screenshotPath)) {
      try {
        await uploadScreenshot(
          baseUrl, authHeader, userManualPage.id, screenDoc.screen.screenshotPath
        );
      } catch {
        // Screenshot upload failure is non-fatal
      }
    }
  }
}
