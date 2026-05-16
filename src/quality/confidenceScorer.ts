function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0;
  const regex = new RegExp(escapeRegExp(keyword), "gi");
  return (text.match(regex) || []).length;
}

export function calculateConfidenceScore(
  title: string,
  content: string,
  query: string
): number {
  const normalizedTitle = title.toLowerCase();
  const normalizedContent = content.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  let score = 0;

  // Başlıkta geçiyorsa güçlü boost
  if (normalizedTitle.includes(normalizedQuery)) {
    score += 40;
  }

  // Content içinde geçme yoğunluğu
  const occurrences = countOccurrences(
    normalizedContent,
    normalizedQuery
  );

  score += Math.min(occurrences * 5, 30);

  // İçerik çok kısa ise düşür
  if (normalizedContent.length < 200) {
    score -= 10;
  }

  // Business rule / endpoint gibi önemli başlık boostları
  const importantKeywords = [
    "business rule",
    "iş kuralı",
    "endpoint",
    "validation",
    "risk",
    "limit",
    "workflow",
    "status",
  ];

  for (const keyword of importantKeywords) {
    if (normalizedTitle.includes(keyword)) {
      score += 5;
    }
  }

  return Math.max(score, 0);
}