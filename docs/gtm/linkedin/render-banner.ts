/**
 * Renders banner.html to linkedin-banner.png at 1584×396 (LinkedIn's profile
 * banner).
 *
 *   bun docs/gtm/linkedin/render-banner.ts
 *
 * Exits non-zero if the tokens or fonts did not load, or the banner overflows.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const dir = import.meta.dir;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 792, height: 400 },
  deviceScaleFactor: 2,
});
await page.goto(`file://${join(dir, "banner.html")}`);
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
  console.error(`The banner could not load ${missing.join(", ")}.`);
  process.exit(1);
}

const banner = page.locator("#banner");
const overflows = await banner.evaluate((el) => {
  const box = el.getBoundingClientRect();
  return [...el.querySelectorAll("*")].some((child) => {
    const r = child.getBoundingClientRect();
    return (
      child.closest("svg") === null &&
      !child.matches("#banner::before") &&
      (r.bottom > box.bottom + 1 || r.right > box.right + 1)
    );
  });
});
await banner.screenshot({ path: join(dir, "linkedin-banner.png") });
await browser.close();
if (overflows) {
  console.error("The banner overflows its frame.");
  process.exit(1);
}
console.log("Wrote linkedin-banner.png");
