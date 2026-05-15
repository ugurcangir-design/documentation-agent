export function cleanGeneratedMarkdown(input: string): string {
  if (!input) return "";

  let text = input;

  // Windows newline temizliği
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Fazla boşluk temizliği
  text = text.replace(/[ \t]+$/gm, "");

  // 3+ boş satırı 2 satıra indir
  text = text.replace(/\n{3,}/g, "\n\n");

  // Boş başlıkları temizle
  text = text.replace(/^#{1,6}\s*$/gm, "");

  // Tekrarlı yatay çizgileri azalt
  text = text.replace(/(\n---\n\s*){2,}/g, "\n---\n");

  // Claude bazen markdown dışı açıklama eklerse basit temizleme
  text = text.replace(/^İşte.*?:\s*/i, "");

  // Markdown tablo satırlarında gereksiz boşlukları azalt
  text = text
    .split("\n")
    .map((line) => {
      if (line.trim().startsWith("|")) {
        return line.trim();
      }
      return line;
    })
    .join("\n");

  return text.trim() + "\n";
}