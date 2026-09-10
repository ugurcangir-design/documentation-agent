import { describe, it, expect } from "vitest";
import { balanceBySourceType } from "../src/analysis/screenContextBuilder";
import type { RankedDocumentSection } from "../src/retrieval/documentSearch";
import type { DocumentSourceType } from "../src/types/documentSource";

function ranked(sourceType: DocumentSourceType, score: number, id: string): RankedDocumentSection {
  return {
    score,
    section: { id, sourceId: id, sourceType, sourceFile: `${id}.md`, title: id, content: "x" },
  };
}

describe("balanceBySourceType — garanti-koltuk skor eşiği", () => {
  it("eşiğin altındaki (alakasız) düşük-skorlu tip garanti koltuğa ZORLANMAZ", () => {
    // topScore=60 → eşik=12. jira(5) eşiğin altında → öne çekilmemeli.
    const input = [
      ranked("brd", 60, "brd1"),
      ranked("brd", 50, "brd2"),
      ranked("brd", 40, "brd3"),
      ranked("jira_task", 5, "jira1"),
    ];
    const out = balanceBySourceType(input);
    // jira (skoru düşük) EN SONA düşer; 2. sıra hâlâ yüksek-skorlu brd olmalı
    // (eski davranış jira'yı 2. sıraya zorluyordu).
    expect(out[out.length - 1]?.section.sourceType).toBe("jira_task");
    expect(out[1]?.section.sourceType).toBe("brd");
  });

  it("eşik üstündeki farklı tip garanti koltuğunu KORUR (denge bozulmaz)", () => {
    // topScore=60 → eşik=12. confluence(30) eşik üstü → öne alınır.
    const input = [
      ranked("brd", 60, "brd1"),
      ranked("brd", 50, "brd2"),
      ranked("confluence", 30, "conf1"),
    ];
    const out = balanceBySourceType(input);
    // İlk iki sırada iki FARKLI tip bulunmalı (denge korunuyor).
    const firstTwo = new Set([out[0]?.section.sourceType, out[1]?.section.sourceType]);
    expect(firstTwo.has("brd")).toBe(true);
    expect(firstTwo.has("confluence")).toBe(true);
  });
});
