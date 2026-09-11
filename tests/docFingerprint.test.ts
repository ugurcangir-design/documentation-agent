import { describe, it, expect } from "vitest";
import {
  computeDocFingerprint,
  computeGenFingerprint,
  docHasQualityWarning,
} from "../src/quality/docFingerprint";
import type { ScreenAnalysis } from "../src/types/screen";
import type { PreparedChunk } from "../src/retrieval/contextBudget";

const analysis = (): ScreenAnalysis => ({
  screenTitle: "Siparişler",
  purpose: "Sipariş listesini yönetir",
  targetAudience: "Operasyon",
  uiElements: [
    { type: "button", label: "Kaydet", description: "kaydeder", action: "kayıt" },
    { type: "filter", label: "Durum", description: "durum filtresi" },
  ],
  workflows: [{ name: "Kayıt oluştur", steps: ["Ekle", "Kaydet"] }],
  dataDisplayed: ["sipariş"],
  navigationOptions: [],
});

const chunk = (title: string, content: string): PreparedChunk => ({
  title, sourceFile: `${title}.md`, sourceType: "brd", content, score: 10,
});

const genFp = "gen-abc";

describe("computeDocFingerprint — artımlı üretim parmak izi", () => {
  it("aynı girdi → aynı parmak izi (deterministik)", () => {
    const a = computeDocFingerprint({ analysis: analysis(), preparedChunks: [chunk("A", "x")], stateLabels: ["s1"], genFp });
    const b = computeDocFingerprint({ analysis: analysis(), preparedChunks: [chunk("A", "x")], stateLabels: ["s1"], genFp });
    expect(a).toBe(b);
  });

  it("UI öğesi değişince parmak izi DEĞİŞİR", () => {
    const base = computeDocFingerprint({ analysis: analysis(), preparedChunks: [], stateLabels: [], genFp });
    const changed = analysis();
    changed.uiElements.push({ type: "button", label: "Sil", description: "siler" });
    const after = computeDocFingerprint({ analysis: changed, preparedChunks: [], stateLabels: [], genFp });
    expect(after).not.toBe(base);
  });

  it("RAG chunk içeriği değişince parmak izi DEĞİŞİR", () => {
    const base = computeDocFingerprint({ analysis: analysis(), preparedChunks: [chunk("A", "eski")], stateLabels: [], genFp });
    const after = computeDocFingerprint({ analysis: analysis(), preparedChunks: [chunk("A", "yeni")], stateLabels: [], genFp });
    expect(after).not.toBe(base);
  });

  it("state sıralaması önemsiz (aynı küme → aynı iz)", () => {
    const a = computeDocFingerprint({ analysis: analysis(), preparedChunks: [], stateLabels: ["s1", "s2"], genFp });
    const b = computeDocFingerprint({ analysis: analysis(), preparedChunks: [], stateLabels: ["s2", "s1"], genFp });
    expect(a).toBe(b);
  });

  it("üretim-config izi (genFp) değişince parmak izi DEĞİŞİR", () => {
    const a = computeDocFingerprint({ analysis: analysis(), preparedChunks: [], stateLabels: [], genFp: "g1" });
    const b = computeDocFingerprint({ analysis: analysis(), preparedChunks: [], stateLabels: [], genFp: "g2" });
    expect(a).not.toBe(b);
  });
});

describe("computeGenFingerprint", () => {
  it("prompt veya şablon değişince değişir", () => {
    const a = computeGenFingerprint({ role: "x" }, { instructions: "y" }, ["t1"]);
    const b = computeGenFingerprint({ role: "x2" }, { instructions: "y" }, ["t1"]);
    const c = computeGenFingerprint({ role: "x" }, { instructions: "y" }, ["t1", "t2"]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(computeGenFingerprint({ role: "x" }, { instructions: "y" }, ["t1"]));
  });
});

describe("docHasQualityWarning", () => {
  it("kalite uyarı banner'larını yakalar (atlama engellenir)", () => {
    expect(docHasQualityWarning("... ⚠️ **ÇIKTI KESİLMİŞ OLABİLİR:** ...")).toBe(true);
    expect(docHasQualityWarning("... **KAPSAM ÖLÇÜLEMEDİ:** ...")).toBe(true);
    expect(docHasQualityWarning("Temiz bir doküman, uyarı yok.")).toBe(false);
  });
});
