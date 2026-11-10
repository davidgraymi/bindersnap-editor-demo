/**
 * Renders the LinkedIn cards in cards.html to the PNGs beside it, at
 * 1080×1350 (LinkedIn's 4:5 portrait).
 *
 *   bun docs/gtm/linkedin/render.ts
 *
 * Exits non-zero if the tokens or fonts did not load, or a card overflows.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const dir = import.meta.dir;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 600, height: 2200 },
  deviceScaleFactor: 2,
});
await page.goto(`file://${join(dir, "cards.html")}`);
await page.evaluate(() => document.fonts.ready);

const missing = await page.evaluate(() => [
  ...(getComputedStyle(document.documentElement)
    .getPropertyValue("--brand-coral")
    .trim()
    ? []
    : ["the token stylesheet"]),
  ...["Lora", "Geist", "Geist Mono"].filter(
    (family) => !document.fonts.check(`12px "${family}"`, "Ab"),
  ),
]);
if (missing.length) {
  console.error(`The cards could not load ${missing.join(", ")}.`);
  process.exit(1);
}

const cards = [
  ["c1", "linkedin-1-filename.png"],
  ["c2", "linkedin-2-surveyor.png"],
  ["c3", "linkedin-3-consultants.png"],
];
let failed = false;
for (const [id, file] of cards) {
  const card = page.locator(`#${id}`);
  const overflows = await card.evaluate((el) => {
    const bottom = el.getBoundingClientRect().bottom;
    return [...el.querySelectorAll("*")].some(
      (child) => child.getBoundingClientRect().bottom > bottom + 1,
    );
  });
  if (overflows) {
    console.error(`Card ${id} overflows its frame.`);
    failed = true;
  }
  await card.screenshot({ path: join(dir, file) });
}
await browser.close();
if (failed) process.exit(1);
console.log(`Wrote ${cards.map(([, file]) => file).join(", ")}`);
