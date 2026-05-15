import { DocumentSection } from "../types/documentSource";

export function parseBrdSections(
  markdown: string,
  sourceFile: string
): DocumentSection[] {
  const lines = markdown.split("\n");

  const sections: DocumentSection[] = [];

  let currentTitle = "Introduction";
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#")) {
      sections.push({
        id: `${sourceFile}-${currentTitle}`,
        sourceId: sourceFile,
        sourceType: "brd",
        sourceFile,
        title: currentTitle,
        content: currentContent.join("\n").trim(),
      });

      currentTitle = trimmed.replace(/^#+\s*/, "");
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  sections.push({
    id: `${sourceFile}-${currentTitle}`,
    sourceId: sourceFile,
    sourceType: "brd",
    sourceFile,
    title: currentTitle,
    content: currentContent.join("\n").trim(),
  });

  return sections.filter(
    (section) => section.content.length > 0
  );
}