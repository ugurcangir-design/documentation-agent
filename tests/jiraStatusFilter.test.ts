import { describe, it, expect } from "vitest";
import { isExcludedJiraStatus } from "../src/ingestion/jiraStatusFilter";

describe("isExcludedJiraStatus", () => {
  it("Backlog / To Do / Cancel statülerini hariç tutar", () => {
    expect(isExcludedJiraStatus("Backlog")).toBe(true);
    expect(isExcludedJiraStatus("To Do")).toBe(true);
    expect(isExcludedJiraStatus("Cancelled")).toBe(true);
    expect(isExcludedJiraStatus("Canceled")).toBe(true);
  });

  it("Türkçe varyasyonları yakalar (İptal, Yapılacak)", () => {
    expect(isExcludedJiraStatus("İptal")).toBe(true);
    expect(isExcludedJiraStatus("Yapılacak")).toBe(true);
  });

  it("Aktif/tamamlanmış statüleri dahil eder (false döner)", () => {
    expect(isExcludedJiraStatus("In Progress")).toBe(false);
    expect(isExcludedJiraStatus("Done")).toBe(false);
    expect(isExcludedJiraStatus("In Review")).toBe(false);
    expect(isExcludedJiraStatus("Devam Ediyor")).toBe(false);
    expect(isExcludedJiraStatus("Tamamlandı")).toBe(false);
  });

  it("Büyük/küçük harf ve fazla boşluğa duyarsız", () => {
    expect(isExcludedJiraStatus("  BACKLOG  ")).toBe(true);
    expect(isExcludedJiraStatus("to    do")).toBe(true);
  });

  it("Boş/tanımsız statüyü muhafazakâr şekilde dahil eder (false)", () => {
    expect(isExcludedJiraStatus("")).toBe(false);
    expect(isExcludedJiraStatus(undefined)).toBe(false);
    expect(isExcludedJiraStatus(null)).toBe(false);
  });
});
