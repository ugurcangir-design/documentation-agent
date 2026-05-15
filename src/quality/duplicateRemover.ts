function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function removeDuplicateParagraphs(input: string): string {
  if (!input) return "";

  const blocks = input
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const block of blocks) {
    const normalized = normalizeForComparison(block);

    if (normalized.length < 40) {
      result.push(block);
      continue;
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(block);
  }

  return result.join("\n\n").trim();
}