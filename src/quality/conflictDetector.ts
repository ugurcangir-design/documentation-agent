import { RankedDocumentSection } from "../retrieval/documentSearch";

export interface DetectedConflict {
  keyword: string;

  sectionA: {
    title: string;
    source: string;
    content: string;
  };

  sectionB: {
    title: string;
    source: string;
    content: string;
  };
}

const conflictKeywords = [
  "enabled",
  "disabled",
  "active",
  "inactive",
  "required",
  "optional",
  "paused",
  "closed",
  "open",
];

export function detectConflicts(
  sections: RankedDocumentSection[]
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];

  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i]?.section;
      const b = sections[j]?.section;
      if (!a || !b) continue;

      const aContent = a.content.toLowerCase();
      const bContent = b.content.toLowerCase();

      for (const keyword of conflictKeywords) {
        const aHas = aContent.includes(keyword);
        const bHas = bContent.includes(keyword);

        if (aHas !== bHas) {
          conflicts.push({
            keyword,

            sectionA: {
              title: a.title,
              source: a.sourceFile,
              content: a.content.substring(0, 300),
            },

            sectionB: {
              title: b.title,
              source: b.sourceFile,
              content: b.content.substring(0, 300),
            },
          });
        }
      }
    }
  }

  return conflicts;
}