import { cleanGeneratedMarkdown } from "../quality/markdownCleaner";
import { callClaude, MODEL_QUALITY } from "../llm/claudeClient";

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
  docType: "userManual" | "technicalDoc";
}): Promise<SectionRegenerateResult> {
  const { fullDocument, sectionHeading, instruction, docType } = params;

  const sections = parseSections(fullDocument);
  const target = sections.find((s) => s.heading === sectionHeading);
  if (!target) throw new Error(`Bölüm bulunamadı: ${sectionHeading}`);

  const roleLabel = docType === "userManual"
    ? "deneyimli bir teknik yazar"
    : "kıdemli bir yazılım mühendisi";

  const prompt = `Sen ${roleLabel}sın. Mevcut bir dökümanın TEK bir bölümünü yeniden yazacaksın. Diğer bölümlere DOKUNMA.

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
${instruction}

---

Sadece "${sectionHeading}" bölümünün yeni halini yaz. Başlığı da dahil et (\`${"#".repeat(target.level)} ${sectionHeading}\` ile başla). Başka bölüm yazma, açıklama ekleme — sadece bölümün yeni hali.`;

  const result = await callClaude({ prompt, maxTokens: 2000, model: MODEL_QUALITY });

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
