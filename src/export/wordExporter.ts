import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  AlignmentType,
  Packer,
} from "docx";
import fs from "fs";
import type { StoredDocument } from "../server/store/documentStore";

function parseMarkdownToParagraphs(
  markdown: string
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = markdown.split("\n");

  for (const line of lines) {
    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2).trim(),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        })
      );
    } else if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(3).trim(),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
        })
      );
    } else if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(4).trim(),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2).trim(),
          bullet: { level: 0 },
        })
      );
    } else if (/^\d+\. /.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^\d+\. /, "").trim(),
          numbering: { reference: "numbered", level: 0 },
        })
      );
    } else if (line.startsWith("---")) {
      paragraphs.push(
        new Paragraph({
          text: "",
          border: {
            bottom: {
              color: "CCCCCC",
              style: BorderStyle.SINGLE,
              size: 6,
            },
          },
          spacing: { before: 200, after: 200 },
        })
      );
    } else if (line.trim() === "") {
      paragraphs.push(new Paragraph({ text: "" }));
    } else {
      // Parse inline bold/italic
      const runs = parseInlineFormatting(line.trim());
      paragraphs.push(new Paragraph({ children: runs }));
    }
  }

  return paragraphs;
}

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];

  // Simple bold parsing: **text**
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);

  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(
        new TextRun({ text: part.slice(2, -2), bold: true })
      );
    } else if (part.startsWith("*") && part.endsWith("*")) {
      runs.push(
        new TextRun({ text: part.slice(1, -1), italics: true })
      );
    } else if (part.startsWith("`") && part.endsWith("`")) {
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          font: "Courier New",
          size: 18,
        })
      );
    } else if (part) {
      runs.push(new TextRun({ text: part }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text: "" })];
}

export async function exportToWord(
  docs: StoredDocument[],
  title: string,
  outputPath: string
): Promise<void> {
  const children: Paragraph[] = [];

  // Cover page
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 56,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Oluşturma tarihi: ${new Date().toLocaleDateString("tr-TR")}`,
          color: "666666",
          size: 22,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 2000 },
    }),
    new Paragraph({
      text: "",
      pageBreakBefore: true,
    })
  );

  // Table of contents heading
  children.push(
    new Paragraph({
      text: "İçindekiler",
      heading: HeadingLevel.HEADING_1,
    })
  );

  for (const doc of docs) {
    children.push(
      new Paragraph({
        text: `• ${doc.screenTitle}`,
        spacing: { before: 100 },
      })
    );
  }

  children.push(
    new Paragraph({
      text: "",
      pageBreakBefore: true,
    })
  );

  // User Manual section
  children.push(
    new Paragraph({
      text: "Kullanıcı Kılavuzu",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  for (const doc of docs) {
    children.push(
      ...parseMarkdownToParagraphs(doc.userManualContent)
    );

    children.push(
      new Paragraph({ text: "", pageBreakBefore: true })
    );
  }

  // Technical doc section
  children.push(
    new Paragraph({
      text: "Teknik Döküman",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    })
  );

  for (const doc of docs) {
    children.push(
      ...parseMarkdownToParagraphs(doc.technicalDocContent)
    );

    children.push(
      new Paragraph({ text: "", pageBreakBefore: true })
    );
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(outputPath, buffer);
}
