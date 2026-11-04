/**
 * Referans bloğu — Analyst Studio biçimi: türe göre gruplanmış (Confluence >
 * BRD > süreç dokümanı > Jira > diğer), her tür için kısa kullanım talimatı,
 * her kaynak `#### [<atıf anahtarı>]` başlığıyla. Model, kılavuzda bu anahtarı
 * `_(Kaynak: <anahtar>)_` olarak AYNEN kullanır → deterministik kapsam ölçümü
 * ve "Kaynaklar" bölümü mümkün olur.
 */
import type { PreparedChunk } from "../retrieval/contextBudget";

const TYPE_HEADER: Record<string, { title: string; hint: string }> = {
  confluence: {
    title: "CONFLUENCE DOKÜMANTASYONU",
    hint: "Ekranın amacı, iş kuralları, alan/sütun anlamları, statü geçişleri ve özel durumlar için BİRİNCİL kaynak. Tablo/sütun/statü adlarını burada geçtiği gibi kullan.",
  },
  brd: {
    title: "BRD (İŞ GEREKSİNİMLERİ)",
    hint: "Ekranın iş süreci içindeki yeri, gereksinimler ve kabul kriterleri. Süreç anlatımı varsa kılavuzun 'Bu Ekran Ne İşe Yarar?' ve akış bölümlerinde kullan.",
  },
  process_analysis: {
    title: "YÜKLENEN DOKÜMANLAR (süreç analizi / eski kılavuz)",
    hint: "Benzer ekranların anlatımı ve süreç detayları. Yalnız BU ekranla ilgili kısmı kullan; başka ekranın/ürünün özelliğini bu ekrana taşıma.",
  },
  jira_task: {
    title: "JIRA KAYITLARI",
    hint: "Geliştirme/hata kayıtları: ekranın gerçek davranışı, düzeltilmiş hatalar, filtre-parametre kuralları. Bir kayıt başka bir ekranı anlatıyorsa KULLANMA. Çelişen kararlar varsa iki kaynağı da belirt.",
  },
  manual: {
    title: "DİĞER DOKÜMANLAR",
    hint: "Destekleyici bilgi; yalnız bu ekranla ilgili kısmı kullan.",
  },
};
const ORDER = ["confluence", "brd", "process_analysis", "jira_task", "manual"];

export function buildReferenceBlock(chunks: PreparedChunk[], sanitize: (s: string) => string): string {
  if (chunks.length === 0) return "";
  const groups = new Map<string, PreparedChunk[]>();
  for (const c of chunks) {
    const g = groups.get(c.sourceType) ?? [];
    g.push(c);
    groups.set(c.sourceType, g);
  }
  const parts: string[] = [];
  for (const type of [...ORDER, ...[...groups.keys()].filter((k) => !ORDER.includes(k))]) {
    const g = groups.get(type);
    if (!g || g.length === 0) continue;
    const h = TYPE_HEADER[type] ?? { title: type.toUpperCase(), hint: "" };
    const body = g
      .map((c) => `#### [${c.citeKey ?? c.title}]\n${sanitize(c.content)}`)
      .join("\n\n---\n\n");
    parts.push(`### ${h.title} (${g.length} kaynak)\n_${h.hint}_\n\n${body}`);
  }
  return parts.join("\n\n");
}

/** Prompt'un dinamik kısmına eklenen ZORUNLU kaynak kullanım kuralları. */
export function buildReferenceUsageRules(chunks: PreparedChunk[]): string {
  if (chunks.length === 0) return "";
  const keys = chunks.map((c) => `[${c.citeKey ?? c.title}]`);
  return `\n\n# KAYNAK KULLANIMI (ZORUNLU)
- Yukarıdaki referans bloklarını AKTİF kullan: ekranın amacı, iş kuralları, alan/sütun anlamları, statüler, filtre davranışları ve özel durumlar için referanstaki bilgiyi kılavuza işle. Görselde görünmeyen ama referansta anlatılan davranışı KOŞULLU ver ("Dokümantasyona göre …").
- Referanstan alınan her somut bilgi cümlesinin sonuna _(Kaynak: <anahtar>)_ ekle. Anahtar, kaynak başlığındaki köşeli parantez içeriğinin AYNISI olmalı; örnek: _(Kaynak: ${(chunks[0]?.citeKey ?? "Confluence: Sayfa Adı")})_. Birden çok kaynak: _(Kaynak: A; B)_.
- Doğrudan görselden görülen öğeler (buton adı, sütun başlığı, yerleşim) için etiket GEREKMEZ.
- Referansta ve görselde OLMAYAN bilgiyi yazma. Kaynaklar birbiriyle veya canlı gözlemle çelişiyorsa iki kaynağı da belirterek 'Davranış Kuralları ve Özel Durumlar' altında uyar.
- 'Kaynaklar' listesi YAZMA — sistem, atıflardan otomatik ekler.
- Kullanılabilir anahtarlar: ${keys.join(" · ")}`;
}
