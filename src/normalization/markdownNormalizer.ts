import { cleanBrokenSentences } from "./sentenceCleaner";

export function normalizeMarkdown(input: string): string {
  if (!input) return "";

  let text = input;

  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/(\w)-\n(\w)/g, "$1$2");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/\n(#{1,6} )/g, "\n\n$1");
  text = text.replace(/'\s*\n\s*/g, "'");

  text = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  text = cleanBrokenSentences(text);

  return text.trim();
}