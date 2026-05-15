'use strict';
/**
 * Generates assets/icon.png (1024×1024) using Sharp + inline SVG.
 * Run once: node scripts/generate-icon.cjs
 */

const path = require('path');
const fs   = require('fs');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const OUT_FILE   = path.join(ASSETS_DIR, 'icon.png');

const SVG = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bgGrad" x1="0" y1="0" x2="0.5" y2="1">
    <stop offset="0%"   stop-color="#1e2540"/>
    <stop offset="100%" stop-color="#0d1117"/>
  </linearGradient>
  <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%"   stop-color="#4f6ef7"/>
    <stop offset="100%" stop-color="#a855f7"/>
  </linearGradient>
  <filter id="glow">
    <feGaussianBlur stdDeviation="18" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<!-- Background -->
<rect width="1024" height="1024" rx="224" fill="url(#bgGrad)"/>

<!-- Subtle glow behind document -->
<ellipse cx="420" cy="430" rx="260" ry="180" fill="#4f6ef7" opacity="0.07"/>

<!-- ── Document card ────────────────────────────────── -->
<rect x="210" y="148" width="374" height="490" rx="32" fill="#1a2138" stroke="#2c3a5e" stroke-width="2"/>

<!-- Folded corner -->
<path d="M504 148 L584 228 L504 228 Z" fill="#0d1117"/>
<line x1="504" y1="148" x2="584" y2="228" stroke="#2c3a5e" stroke-width="2"/>

<!-- Ruled lines -->
<rect x="260" y="270" width="214" height="11" rx="5.5" fill="#4f6ef7"/>
<rect x="260" y="306" width="260" height="11" rx="5.5" fill="#5a6d9a" opacity="0.7"/>
<rect x="260" y="342" width="190" height="11" rx="5.5" fill="#5a6d9a" opacity="0.55"/>
<rect x="260" y="378" width="244" height="11" rx="5.5" fill="#5a6d9a" opacity="0.4"/>
<rect x="260" y="414" width="176" height="11" rx="5.5" fill="#5a6d9a" opacity="0.3"/>
<rect x="260" y="450" width="214" height="11" rx="5.5" fill="#5a6d9a" opacity="0.2"/>
<rect x="260" y="486" width="148" height="11" rx="5.5" fill="#5a6d9a" opacity="0.14"/>
<rect x="260" y="522" width="190" height="11" rx="5.5" fill="#5a6d9a" opacity="0.09"/>

<!-- ── AI badge (bottom-right overlap) ─────────────── -->
<!-- Outer glow rings -->
<circle cx="678" cy="552" r="124" fill="url(#accentGrad)" opacity="0.13"/>
<circle cx="678" cy="552" r="86"  fill="url(#accentGrad)" opacity="0.22"/>
<!-- Solid circle -->
<circle cx="678" cy="552" r="54"  fill="url(#accentGrad)"/>
<!-- Sparkle / magic wand star shape -->
<path d="M678 520 L688 544 L714 552 L688 560 L678 584 L668 560 L642 552 L668 544 Z"
      fill="white" filter="url(#glow)"/>

<!-- ── Word-mark ─────────────────────────────────────── -->
<text x="512" y="728"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="84" font-weight="800"
      fill="white" text-anchor="middle" letter-spacing="-1.5">DocAgent</text>

<text x="512" y="792"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="32" font-weight="300"
      fill="#6b7db8" text-anchor="middle" letter-spacing="3.5">ANALYSIS STUDIO</text>
</svg>`;

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.warn('[icon] sharp is not installed — skipping icon generation.');
    console.warn('[icon] Run: npm install --save-dev sharp');
    return;
  }

  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  await sharp(Buffer.from(SVG))
    .png()
    .resize(1024, 1024)
    .toFile(OUT_FILE);

  console.log('[icon] Generated:', OUT_FILE);
}

main().catch((err) => {
  console.error('[icon] Failed:', err.message);
  process.exit(1);
});
