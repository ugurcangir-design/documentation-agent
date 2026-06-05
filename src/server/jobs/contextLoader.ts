/**
 * Job-stable bağlam yükleyici. Bir doküman job'ı başlarken bütün
 * referans kaynakları **bir kez** okur ve in-memory tutar:
 *   - Swagger endpoint'leri (yerel + URL ile çekilenler)
 *   - BRD bölümleri (data/brd/*.md)
 *   - Yüklenen referans dökümanlar (.docx/.pdf/.md/.txt)
 *   - Stored Confluence sayfaları
 *   - Stored Jira issue'ları (her issue ayrı section)
 *   - Legacy Confluence env taraması (sadece kayıtlı space yoksa)
 *   - Şablonlar (üslup referansı için)
 *
 * Çift-okuma temizliği: `confluence_<id>` / `jira_<key>` id'leri
 * tekilleştirilir. BRD section'ları korunur (aynı başlık iki kez
 * gelebilir, kasten ayrı tutulur).
 */

import fs from "fs";

import { readSwaggerFiles } from "../../ingestion/swaggerReader";
import { extractEndpoints } from "../../ingestion/swaggerParser";
import { loadDocuments } from "../../ingestion/documentLoader";
import { readConfluencePages } from "../../ingestion/confluenceReader";
import { parseBrdSections } from "../../retrieval/brdSectionParser";
import { parseDocumentSections } from "../../retrieval/flatTextSectionParser";
import { cleanReferenceText, decodeHtmlEntities } from "../../quality/referenceTextCleaner";
import { isExcludedJiraStatus } from "../../ingestion/jiraStatusFilter";
import { referenceStore } from "../store/referenceStore";

import type { Endpoint } from "../../types/endpoint";
import type { DocumentSection } from "../../types/documentSource";

export interface LoadedContext {
  allEndpoints: Endpoint[];
  allSections: DocumentSection[];
  templateContents: string[];
}

export async function loadJobContext(jobId: string): Promise<LoadedContext> {
  const allEndpoints: Endpoint[] = [];

  // 1. Local swagger files
  for (const sf of readSwaggerFiles()) {
    allEndpoints.push(...extractEndpoints(sf.content, sf.fileName));
  }

  // 2. Swagger references (fetched URLs)
  for (const swagRef of referenceStore.getAllSwagger()) {
    if (fs.existsSync(swagRef.specFile)) {
      try {
        const spec = JSON.parse(fs.readFileSync(swagRef.specFile, "utf-8")) as Record<string, unknown>;
        allEndpoints.push(...extractEndpoints(spec, swagRef.name));
      } catch {
        // ignore parse errors
      }
    }
  }

  let allSections: DocumentSection[] = [];

  // 3. BRD docs (local markdown)
  const brdDocs = loadDocuments({ type: "brd", directory: "data/brd", extension: ".md" });
  for (const doc of brdDocs) {
    allSections.push(...parseBrdSections(doc.content, doc.fileName));
  }

  // 4. Uploaded reference documents (.docx/.pdf → text). İki düzeltme:
  //    (a) parseDocumentSections dispatcher kullan — flat text doc'larda
  //        (mammoth/pdf-parse çıktısı `#` heading taşımaz) numbered ve
  //        ALL-CAPS heading'leri sezgisel tespit eder. Eski parseBrdSections
  //        bu doc'ları tek "Introduction" bloğuna sıkıştırıyordu.
  //    (b) docRef.type === "reference" doc'larını "process_analysis"
  //        sourceType ile etiketle — süreç analizi / proses doc'ları
  //        priority sisteminde 0.95 ağırlık alır (BRD 1.0'a yakın);
  //        eskiden "brd" olarak etiketleniyordu (priority tanımı ölü kod'du).
  for (const docRef of referenceStore.getDocuments()) {
    if (docRef.type === "template") continue;
    if (fs.existsSync(docRef.contentFile)) {
      const raw = fs.readFileSync(docRef.contentFile, "utf-8");
      const content = cleanReferenceText(raw);
      const sourceType = docRef.type === "reference" ? "process_analysis" : "brd";
      allSections.push(...parseDocumentSections(content, docRef.originalName, sourceType));
    }
  }

  // 5. Stored Confluence references
  for (const conf of referenceStore.getAllConfluence()) {
    if (fs.existsSync(conf.contentFile)) {
      const raw = fs.readFileSync(conf.contentFile, "utf-8");
      const content = cleanReferenceText(decodeHtmlEntities(raw));
      allSections.push({
        id: `confluence_${conf.pageId}`,
        sourceId: `confluence_${conf.pageId}`,
        title: conf.title,
        content,
        sourceType: "confluence",
        sourceFile: conf.title,
      });
    }
  }

  // 5b. Synced Jira issues — each issue becomes its own section
  for (const jira of referenceStore.getAllJira()) {
    if (!fs.existsSync(jira.contentFile)) continue;
    try {
      const issues = JSON.parse(fs.readFileSync(jira.contentFile, "utf-8")) as Array<{
        key: string;
        summary?: string;
        status?: string;
        type?: string;
        description?: string;
      }>;
      for (const issue of issues) {
        // Defensive: bu fix'ten ÖNCE senkronize edilmiş JSON'larda
        // Backlog/To Do/Cancel issue'ları kalmış olabilir; sync artık
        // bunları yazmıyor ama eski dump'lar için burada da eliyoruz.
        if (isExcludedJiraStatus(issue.status)) continue;
        const body = [
          issue.type ? `Tip: ${issue.type}` : "",
          issue.status ? `Durum: ${issue.status}` : "",
          issue.description ?? "",
        ]
          .filter(Boolean)
          .join("\n");
        if (!body.trim()) continue;
        allSections.push({
          id: `jira_${issue.key}`,
          sourceId: `jira_${jira.projectKey}`,
          title: `${issue.key} — ${issue.summary ?? ""}`.trim(),
          content: body,
          sourceType: "jira_task",
          sourceFile: `${jira.projectKey} (Jira)`,
        });
      }
    } catch {
      // skip malformed jira dump
    }
  }

  // 6. Legacy Confluence env scan — only when no synced space exists
  if (referenceStore.getSources("confluence-space").length === 0) {
    try {
      allSections.push(...(await readConfluencePages()));
    } catch {
      // not configured
    }
  }

  // 7. Templates (for style reference)
  const templateContents: string[] = [];
  for (const tplRef of referenceStore.getDocuments("template")) {
    if (fs.existsSync(tplRef.contentFile)) {
      const raw = fs.readFileSync(tplRef.contentFile, "utf-8");
      templateContents.push(cleanReferenceText(raw));
    }
  }

  // Dedupe synced sections (confluence_*/jira_*) — BRD untouched.
  {
    const seen = new Set<string>();
    const before = allSections.length;
    allSections = allSections.filter((s) => {
      const isSynced = s.id.startsWith("confluence_") || s.id.startsWith("jira_");
      if (!isSynced) return true;
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    const removed = before - allSections.length;
    if (removed > 0) {
      console.log(`[docjob ${jobId}] ${removed} yinelenen referans bölümü temizlendi`);
    }
  }

  // Inventory log
  const sectionsByType = allSections.reduce<Record<string, number>>((acc, s) => {
    acc[s.sourceType] = (acc[s.sourceType] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`[docjob ${jobId}] CONTEXT INVENTORY:`);
  console.log(`  - Endpoints: ${allEndpoints.length}`);
  console.log(`  - BRD/Confluence sections: ${allSections.length}`);
  console.log(`  - Section types: ${JSON.stringify(sectionsByType)}`);
  console.log(`  - Templates: ${templateContents.length} (total chars: ${templateContents.reduce((s, t) => s + t.length, 0)})`);
  if (allSections.length > 0) {
    console.log(`  - First 3 sections: ${allSections.slice(0, 3).map((s) => `'${s.title}'`).join(", ")}`);
  }

  return { allEndpoints, allSections, templateContents };
}
