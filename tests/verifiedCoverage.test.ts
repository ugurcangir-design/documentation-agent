import { describe, it, expect, vi, beforeEach } from "vitest";

// callClaude'u mock'la — gerçek Haiku çağrısı yapmadan judge davranışını test et.
const callClaudeMock = vi.fn();
vi.mock("../src/llm/claudeClient", () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
  MODEL_FAST: "claude-haiku-4-5",
}));

import { computeVerifiedCoverage } from "../src/quality/verifiedCoverage";
import type { UIElement } from "../src/types/screen";

const el = (label: string): UIElement => ({ label, type: "button", description: "" });
// Her iki etiket de gövdede TAM kelime → raw coverage ikisini de "covered" sayar,
// böylece judge'a gönderilirler.
const BODY = "Kaydet ve İptal ve Sil işlemleri bu ekranda yapılır.";

function judgeResponse(verdicts: Array<{ label: string; explained: boolean }>) {
  return { text: JSON.stringify({ verdicts }), inputTokens: 0, outputTokens: 0 };
}

describe("computeVerifiedCoverage — fail-closed doğrulama", () => {
  beforeEach(() => callClaudeMock.mockReset());

  it("judge 'explained:false' derse öğe missing'e taşınır; verified:true", async () => {
    callClaudeMock.mockResolvedValue(judgeResponse([
      { label: "Kaydet", explained: true },
      { label: "İptal", explained: false },
    ]));
    const r = await computeVerifiedCoverage([el("Kaydet"), el("İptal")], BODY);
    expect(r.missing).toContain("İptal (button)");
    expect(r.missing).not.toContain("Kaydet (button)");
    expect(r.verified).toBe(true);
  });

  it("judge bir öğe için verdict VERMEZSE (atlarsa) o öğe belirsiz → missing (fail-closed)", async () => {
    // 'Sil' için verdict yok → eskiden sessizce covered kalıyordu.
    callClaudeMock.mockResolvedValue(judgeResponse([
      { label: "Kaydet", explained: true },
    ]));
    const r = await computeVerifiedCoverage([el("Kaydet"), el("Sil")], BODY);
    expect(r.missing).toContain("Sil (button)");
    expect(r.missing).not.toContain("Kaydet (button)");
    expect(r.verified).toBe(true);
  });

  it("label diakritik/boşluk farkıyla dönse de normalize eşleşir (yanlış downgrade yok)", async () => {
    callClaudeMock.mockResolvedValue(judgeResponse([
      { label: "  KAYDET ", explained: true },
      { label: "iptal", explained: true },
    ]));
    const r = await computeVerifiedCoverage([el("Kaydet"), el("İptal")], BODY);
    expect(r.missing).not.toContain("Kaydet (button)");
    expect(r.missing).not.toContain("İptal (button)");
    expect(r.verified).toBe(true);
  });

  it("judge yanıtı bozuksa (JSON yok) raw coverage döner ama verified:false", async () => {
    // Judge çağrısı döner ama ayrıştırılamaz çıktı verir → doğrulama yapılamadı.
    callClaudeMock.mockResolvedValue({ text: "üzgünüm, yardımcı olamam", inputTokens: 0, outputTokens: 0 });
    const r = await computeVerifiedCoverage([el("Kaydet"), el("İptal")], BODY);
    // Raw: ikisi de gövdede geçtiği için missing boş; ama doğrulama YAPILAMADI.
    expect(r.missing).toEqual([]);
    expect(r.verified).toBe(false);
  });
});
