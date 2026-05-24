/**
 * documentationJob içindeki çift-okuma temizliği davranışını izole testler.
 * Aynı `confluence_<id>` veya `jira_<key>` iki kez geldiğinde tekilleşmeli;
 * BRD bölümleri (aynı başlık iki kez gelse bile) korunmalı.
 */

import { describe, it, expect } from "vitest";
import type { DocumentSection } from "../src/types/documentSource";

function dedupeSyncedSections(sections: DocumentSection[]): DocumentSection[] {
  const seen = new Set<string>();
  return sections.filter((s) => {
    const isSynced = s.id.startsWith("confluence_") || s.id.startsWith("jira_");
    if (!isSynced) return true;
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

const mk = (id: string, type: DocumentSection["sourceType"], title = "T"): DocumentSection => ({
  id, sourceId: id, sourceType: type, sourceFile: "f", title, content: "c"
});

describe("dedupeSyncedSections (documentationJob davranış izole)", () => {
  it("Aynı confluence_<id> ikinci kez gelirse atılır", () => {
    const out = dedupeSyncedSections([
      mk("confluence_42", "confluence"),
      mk("confluence_42", "confluence"),
      mk("confluence_99", "confluence"),
    ]);
    expect(out.map((s) => s.id)).toEqual(["confluence_42", "confluence_99"]);
  });

  it("Aynı jira_<key> ikinci kez gelirse atılır", () => {
    const out = dedupeSyncedSections([
      mk("jira_ABC-1", "jira_task"),
      mk("jira_ABC-1", "jira_task"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("BRD bölümleri aynı id ile iki kez gelse bile korunur", () => {
    const out = dedupeSyncedSections([
      mk("brd.md-Intro", "brd"),
      mk("brd.md-Intro", "brd"),
    ]);
    expect(out).toHaveLength(2);
  });
});
