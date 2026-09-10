import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { callClaude, MODEL_QUALITY, type ClaudeImage } from "../llm/claudeClient";

export interface SectionRegenerateResult {
  newContent: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ParsedSection {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
}

export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split("\n");
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      if (current) {
        current.endLine = i - 1;
        current.text = lines.slice(current.startLine, current.endLine + 1).join("\n");
        sections.push(current);
      }
      current = {
        heading: match[2] ?? "",
        level: (match[1] ?? "").length,
        startLine: i,
        endLine: -1,
        text: "",
      };
    }
  }
  if (current) {
    current.endLine = lines.length - 1;
    current.text = lines.slice(current.startLine, current.endLine + 1).join("\n");
    sections.push(current);
  }
  return sections;
}

export async function regenerateSection(params: {
  fullDocument: string;
  sectionHeading: string;
  instruction: string;
  /** Ekran görselleri — verilirse model bölümü ekrandan (uydurmadan) yazar. */
  mainImageBase64?: string;
  mainImagePath?: string;
  images?: ClaudeImage[];
}): Promise<SectionRegenerateResult> {
  const { fullDocument, sectionHeading, instruction } = params;

  const sections = parseSections(fullDocument);
  const target = sections.find((s) => s.heading === sectionHeading);
  if (!target) throw new Error(`Bölüm bulunamadı: ${sectionHeading}`);

  const hasImages = !!(params.mainImageBase64 || params.mainImagePath || (params.images && params.images.length > 0));
  const antiFab = hasImages
    ? `\n\n**UYDURMA YASAK:** Sana ekran görselleri verildi. Yalnız görselde
gördüğünü yaz; görselde kanıtı olmayan davranış/alan/mesaj/değer EKLEME. UI
metinlerini görseldeki yazımla BİREBİR kullan.`
    : `\n\n**UYDURMA YASAK:** Dökümanda VEYA analistin talebinde açıkça
bulunmayan bir davranış/alan/mesaj/değer EKLEME — mevcut içeriği koru,
bilgi uydurma.`;

  const prompt = `Sen deneyimli bir teknik yazarsın. Mevcut bir dökümanın TEK bir bölümünü yeniden yazacaksın. Diğer bölümlere DOKUNMA.

# Dökümanın Tamamı (Bağlam)
${fullDocument}

---

# Yeniden Yazılacak Bölüm
"${sectionHeading}" başlıklı bölüm.

Mevcut hali:
\`\`\`
${target.text}
\`\`\`

# Analistin Talebi
${instruction}${antiFab}

---

Sadece "${sectionHeading}" bölümünün yeni halini yaz. Başlığı da dahil et (\`${"#".repeat(target.level)} ${sectionHeading}\` ile başla). Başka bölüm yazma, açıklama ekleme — sadece bölümün yeni hali.`;

  const result = await callClaude({
    prompt,
    maxTokens: 2000,
    model: MODEL_QUALITY,
    ...(params.mainImageBase64 ? { imageBase64: params.mainImageBase64 } : {}),
    ...(params.mainImagePath ? { imagePath: params.mainImagePath } : {}),
    ...(params.images && params.images.length > 0 ? { images: params.images } : {}),
  });

  const lines = fullDocument.split("\n");
  const before = lines.slice(0, target.startLine);
  const after = lines.slice(target.endLine + 1);
  const newSection = cleanGeneratedMarkdown(result.text).trim();
  const newContent = [...before, newSection, ...after].join("\n");

  return {
    newContent,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
