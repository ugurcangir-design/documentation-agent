import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// data/prompts/config.json git'te VE canlı config (PromptsPage PUT ile yazar).
// Bu test, kılavuz içerik STANDARDININ (zorunlu bölümler + veri doğruluğu
// kuralları) yanlışlıkla silinmesine/değişmesine karşı regresyon korumasıdır.
const CONFIG_PATH = path.join(process.cwd(), "data", "prompts", "config.json");

interface PromptCfg {
  outputStructure?: string;
  rules?: string[];
  instructions?: string;
}

function loadConfig(): Record<string, PromptCfg> {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, PromptCfg>;
}

describe("prompt config — kullanıcı kılavuzu içerik standardı", () => {
  const cfg = loadConfig();
  const um = cfg["userManual"]!;

  it("userManual mevcut ve outputStructure standart bölümleri içerir", () => {
    expect(um).toBeDefined();
    const s = um.outputStructure ?? "";
    for (const section of [
      "### Bu Ekran Ne İşe Yarar?",
      "### Ekrana Erişim",
      "### Ekrana İlk Bakış",
      "### Adım Adım Kullanım",
      "### Uyarı ve Hata Mesajları",
      "### Sık Sorular ve İpuçları",
    ]) {
      expect(s).toContain(section);
    }
  });

  it("ekranda karşılığı olmayan bölümü atlama talimatı var (uydurma önleme)", () => {
    expect(um.outputStructure ?? "").toContain("karşılığı OLMAYANI tamamen atla");
  });

  it("veri doğruluğu kuralları var: uydurma yasağı + birebir metin + tek terim", () => {
    const rules = (um.rules ?? []).join("\n");
    expect(rules).toContain("UYDURMA YASAK");
    expect(rules).toContain("BİREBİR");
    expect(rules).toContain("TEK terim");
  });

  it("canlı uygulama gözlemi (MCP) BRD'den öncelikli sayılır kuralı var", () => {
    const rules = (um.rules ?? []).join("\n");
    expect(rules).toContain("CANLI UYGULAMA GÖZLEMİ");
    expect(rules).toContain("DAHA ÖNCELİKLİDİR");
  });

  it("technicalDoc kaydı kaldırıldı (özellik tamamen çıkarıldı)", () => {
    expect(cfg["technicalDoc"]).toBeUndefined();
  });

  it("screenAnalysis mevcut (analiz pipeline'ı buna bağlı)", () => {
    expect(cfg["screenAnalysis"]?.instructions).toBeTruthy();
  });
});
