import { describe, it, expect } from "vitest";
import { getSourcePriority, applySourcePriority } from "../src/quality/sourcePriority";

describe("sourcePriority", () => {
  it("BRD en yüksek (1.0), Confluence > Jira > manual sırası korunur", () => {
    expect(getSourcePriority("brd")).toBe(1.0);
    expect(getSourcePriority("process_analysis")).toBeCloseTo(0.95);
    expect(getSourcePriority("confluence")).toBeCloseTo(0.85);
    expect(getSourcePriority("jira_task")).toBeCloseTo(0.75);
    expect(getSourcePriority("manual")).toBeCloseTo(0.6);
  });

  it("applySourcePriority skoru ağırlıkla çarpar ve yuvarlar", () => {
    expect(applySourcePriority(100, "brd")).toBe(100);
    expect(applySourcePriority(100, "confluence")).toBe(85);
    expect(applySourcePriority(100, "jira_task")).toBe(75);
  });
});
