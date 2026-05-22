/**
 * Cleans raw text extracted from PDFs (templates, BRD, process-analysis
 * docs). PDF extraction leaves a lot of noise that, when fed to the LLM,
 * crowds out the actual content:
 *   - table-of-contents lines full of dot leaders
 *   - page markers ("-- 3 of 30 --")
 *   - repeated running headers/footers
 *   - bare page numbers on their own line
 *
 * Without this, `template.slice(0, 7000)` can be 100% table of contents
 * and the model never sees real prose to imitate.
 */

// Common named HTML entities found in Confluence storage-format text.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö", auml: "ä", Auml: "Ä",
  ccedil: "ç", Ccedil: "Ç", scaron: "ş", ntilde: "ñ",
  iuml: "ï", euml: "ë", agrave: "à", eacute: "é", egrave: "è",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "'", lsquo: "'",
  rdquo: "”", ldquo: "“", deg: "°", copy: "©", reg: "®",
  trade: "™", middot: "·", bull: "•", laquo: "«", raquo: "»",
};

/**
 * Decode HTML entities — named (&uuml;), decimal (&#252;) and hex
 * (&#xFC;). Confluence storage-format text is full of these and they
 * pollute both retrieval scoring and the LLM prompt if left raw.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch { return " "; }
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    // Any entity still left after the named-entity pass is one we don't have
    // a glyph for. Leaving raw "&xxx;" codes in the text pollutes retrieval
    // scoring and the LLM prompt, so drop them entirely.
    .replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, " ");
}

/** A line is a TOC entry if it has a run of dot leaders. */
function isTocLine(line: string): boolean {
  return /\.{5,}/.test(line);
}

/** A line is a page marker like "-- 3 of 30 --" or "Page 4". */
function isPageMarker(line: string): boolean {
  const t = line.trim();
  return (
    /^-{1,4}\s*\d+\s*(of|\/)\s*\d+\s*-{1,4}$/i.test(t) ||
    /^page\s+\d+$/i.test(t) ||
    /^\d{1,4}$/.test(t) // bare page number
  );
}

/**
 * Clean reference text. If `runningHeader` is detected (a short line
 * that repeats many times — typical PDF running header), it's removed
 * too.
 */
export function cleanReferenceText(raw: string): string {
  if (!raw) return "";

  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  // Detect a running header: a non-empty line < 80 chars that appears
  // 4+ times is almost certainly a repeated page header/footer.
  const freq = new Map<string, number>();
  for (const l of lines) {
    const t = l.trim();
    if (t && t.length < 80) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const runningHeaders = new Set(
    [...freq.entries()].filter(([, n]) => n >= 4).map(([t]) => t)
  );

  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (isTocLine(line)) continue;
    if (isPageMarker(line)) continue;
    if (runningHeaders.has(t)) continue;
    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")  // collapse blank runs
    .trim();
}
