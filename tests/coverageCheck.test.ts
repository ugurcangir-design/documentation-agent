import { describe, it, expect } from "vitest";
import { computeCoverage, isCovered } from "../src/quality/coverageCheck";
import type { UIElement } from "../src/types/screen";

const el = (label: string, type: UIElement["type"] = "button"): UIElement => ({
  label, type, description: ""
});

describe("isCovered", () => {
  it("Normalize edilmiş tam etiket eşleşmesini yakalar", () => {
    expect(isCovered("Kaydet", "Formu doldurun ve Kaydet tuşuna basın.")).toBe(true);
  });

  it("Diakritik fark eden eşleşmeleri yakalar", () => {
    expect(isCovered("Ödeme", "ödeme bilgileri ekranı")).toBe(true);
  });

  it("Çok kelimeli etikette ardışık 2-token eşleşmesi yeterlidir", () => {
    // 'yeni kayıt' pair'i gövdede geçer → kapsanır.
    expect(isCovered("Yeni Kayıt Ekle", "yeni kayıt formu açılır")).toBe(true);
    // Hiçbir ardışık 2-token gövdede yok → kapsanmaz.
    expect(isCovered("Yeni Kayıt Ekle", "alakasız bir paragraf")).toBe(false);
  });

  it("Tek kelimeli etikette gövdede tek-token yeterlidir", () => {
    expect(isCovered("Filtre", "filtre paneli açılır")).toBe(true);
  });

  it("Hiçbir kelime geçmiyorsa kapsanmaz", () => {
    expect(isCovered("Yeni Kayıt", "alakasız bir paragraf")).toBe(false);
  });
});

describe("computeCoverage", () => {
  it("Boş element listesinde %100 döner", () => {
    const r = computeCoverage([], "metin");
    expect(r.coveragePct).toBe(100);
    expect(r.missing).toEqual([]);
  });

  it("Eksik öğeleri label + type ile listeler", () => {
    const r = computeCoverage(
      [el("Kaydet"), el("İptal"), el("Sil")],
      "Kaydet ve İptal butonları görünür."
    );
    expect(r.coveredElements).toBe(2);
    expect(r.totalElements).toBe(3);
    expect(r.coveragePct).toBe(67);
    expect(r.missing).toEqual(["Sil (button)"]);
  });
});
