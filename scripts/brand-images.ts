/**
 * Draw the site's icons and its link-preview image from the logo mark, into
 * `apps/app/public`. Run by hand after the mark changes, and commit the output:
 *
 *   bun scripts/brand-images.ts
 *
 * Every image is the same mark the landing nav and the app's top bar show —
 * the two stacked pages in `packages/ui-tokens/img/logo-mark.svg`, white on a
 * coral tile — so a browser tab, a home-screen icon and a link pasted into a
 * text or a post all look like the product they open. The mark's geometry is
 * read from that file, never copied, so it cannot drift.
 *
 * Rendering uses Playwright's Chromium, which the integration tests already
 * install, and Google Fonts for Lora and Geist, so it needs the network.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "apps/app/public");

/* The fixed brand values from bindersnap-tokens.css. An image cannot read a
   CSS variable, and these are the values that do not change with the theme. */
const CORAL = "#e85d26"; // --brand-coral
const CORAL_TEXT = "#c84a0b"; // --bs-coral-text, light
const INK = "#1c1917"; // --brand-ink
const PAPER = "#fafaf7"; // --bs-page-bg, light
const SECONDARY = "#44403c"; // --bs-text-secondary, light
const MUTED = "#78716c"; // --brand-muted
const RULE = "#e7e4df"; // --brand-rule

/** The inside of the mark's <symbol>: two outlined pages, in an 18×18 box. */
const MARK = (() => {
  const svg = readFileSync(
    join(ROOT, "packages/ui-tokens/img/logo-mark.svg"),
    "utf8",
  );
  const body = /<symbol[^>]*>([\s\S]*?)<\/symbol>/.exec(svg)?.[1];
  if (!body) throw new Error("logo-mark.svg has no <symbol>");
  return body.replace(/\s+/g, " ").trim();
})();

/**
 * The mark in white on a coral tile, as a 100×100 SVG.
 *
 * `glyph` is the mark's size as a share of the tile: the app's top bar draws
 * 18px on 28px, 0.64. `stroke` thickens the lines for the smallest sizes,
 * where 1.5 in an 18px box falls under one device pixel. `bleed` fills the
 * square for platforms that cut their own shape (iOS, Android's maskable).
 */
function tile({
  glyph = 0.64,
  stroke = 1.5,
  bleed = false,
}: { glyph?: number; stroke?: number; bleed?: boolean } = {}): string {
  const size = 100 * glyph;
  const at = (100 - size) / 2;
  // The pages' outline spans x 1.25–15.75 of the 18 box, so its middle is
  // 8.5, not 9: shift the view half a unit to centre it.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"${
    bleed ? "" : ' rx="22"'
  } fill="${CORAL}"/><svg x="${at}" y="${at}" width="${size}" height="${size}" viewBox="-0.5 0 18 18" fill="none" color="#ffffff">${MARK.replace(
    /stroke-width="[\d.]+"/g,
    `stroke-width="${stroke}"`,
  )}</svg></svg>`;
}

/** An .ico holding PNGs, which every browser since IE 11 reads. */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((png) => png.data)]);
}

const FONTS =
  "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,600;1,600&family=Geist:wght@400;500&family=Geist+Mono:wght@500&display=block";

/**
 * The card a link to bindersnap.com unfurls into: 1200×630, the size Open
 * Graph and X's large card both take. Paper, a Lora headline and one coral
 * accent, per docs/bindersnap-social-cheatsheet.html. X trims a 2:1 strip from
 * the middle, so nothing sits within 40px of the top or bottom edge.
 */
const SHARE_CARD = `<!doctype html>
<html><head>
<link rel="stylesheet" href="${FONTS}">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: ${PAPER};
    font-family: Geist, sans-serif; color: ${INK};
    padding: 72px 88px;
    display: flex; flex-direction: column;
    border-bottom: 10px solid ${CORAL};
  }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand svg { width: 60px; height: 60px; display: block; }
  .brand span {
    font-family: Lora, serif; font-weight: 600; font-size: 36px;
    letter-spacing: -0.01em;
  }
  h1 {
    margin-top: auto;
    font-family: Lora, serif; font-weight: 600; font-size: 68px;
    line-height: 1.08; letter-spacing: -0.02em;
  }
  .accent { color: ${CORAL_TEXT}; font-style: italic; }
  .underline {
    text-decoration: underline; text-decoration-color: ${CORAL};
    text-decoration-thickness: 6px; text-underline-offset: 10px;
  }
  p {
    margin-top: 28px; max-width: 900px;
    font-size: 28px; line-height: 1.4; color: ${SECONDARY};
  }
  .foot {
    margin-top: auto; padding-top: 20px; border-top: 1px solid ${RULE};
    font-family: "Geist Mono", monospace; font-weight: 500; font-size: 22px;
    color: ${MUTED}; letter-spacing: 0.02em;
  }
</style></head>
<body>
  <div class="brand">${tile()}<span>Bindersnap</span></div>
  <h1>The surveyor asks which version<br>you <span class="accent">approved.</span> <span class="underline">Show them.</span></h1>
  <p>Every policy with its current approved version and the record of who signed off on it.</p>
  <div class="foot">bindersnap.com</div>
</body></html>`;

mkdirSync(OUT, { recursive: true });

const favicon = tile({ glyph: 0.7, stroke: 1.75 });
writeFileSync(join(OUT, "favicon.svg"), `${favicon}\n`);

const browser = await chromium.launch();
const page = await browser.newPage();

async function png(svg: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true });
}

// The browser tab: the lines are thickened most where the icon is smallest.
writeFileSync(
  join(OUT, "favicon.ico"),
  ico([
    { size: 16, data: await png(tile({ glyph: 0.76, stroke: 2.25 }), 16) },
    { size: 32, data: await png(tile({ glyph: 0.72, stroke: 2 }), 32) },
    { size: 48, data: await png(favicon, 48) },
  ]),
);

// iOS rounds the corners itself and shows any transparency as black.
writeFileSync(
  join(OUT, "apple-touch-icon.png"),
  await png(tile({ glyph: 0.6, bleed: true }), 180),
);

// The web app manifest's icons. Android crops "maskable" ones to a circle as
// small as 80% of the square, so that one keeps the mark inside it.
writeFileSync(join(OUT, "icon-192.png"), await png(tile(), 192));
writeFileSync(join(OUT, "icon-512.png"), await png(tile(), 512));
writeFileSync(
  join(OUT, "icon-maskable-512.png"),
  await png(tile({ glyph: 0.52, bleed: true }), 512),
);

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(SHARE_CARD, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
writeFileSync(join(OUT, "og-image.png"), await page.screenshot());

await browser.close();
console.log(`Wrote the icons and the share card to ${OUT}`);
