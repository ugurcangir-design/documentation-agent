export function cleanBrokenSentences(input: string): string {
  if (!input) return "";

  const lines = input.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const current = line.trim();

    if (!current) {
      result.push("");
      continue;
    }

    const previous = result[result.length - 1];

    const isMarkdownStructure =
      current.startsWith("#") ||
      current.startsWith("- ") ||
      current.startsWith("* ") ||
      current.startsWith(">") ||
      current.startsWith("|") ||
      current.startsWith("```") ||
      /^\d+\./.test(current);

    const previousIsMarkdownStructure =
      previous?.startsWith("#") ||
      previous?.startsWith("- ") ||
      previous?.startsWith("* ") ||
      previous?.startsWith(">") ||
      previous?.startsWith("|") ||
      previous?.startsWith("```") ||
      /^\d+\./.test(previous ?? "");

    const previousEndsSentence = /[.!?:;)]$/.test(previous ?? "");

    const shouldJoinWithPrevious =
      previous &&
      !previousIsMarkdownStructure &&
      !isMarkdownStructure &&
      !previousEndsSentence;

    if (shouldJoinWithPrevious) {
      result[result.length - 1] = `${previous} ${current}`;
    } else {
      result.push(current);
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}