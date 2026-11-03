/**
 * Renders the one-pager to the PDF and PNG beside it, which the site serves
 * at /bindersnap-one-pager.pdf and .png (`sharePage.ts`).
 *
 *   bun apps/site/one-pager/render.ts
 *
 * Exits non-zero if the page no longer fits on one US Letter sheet.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const dir = import.meta.dir;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 816, height: 1056 },
  // Sharp enough pasted into an email, small enough to load on /share.
  deviceScaleFactor: 1.5,
});
await page.goto(`file://${join(dir, "bindersnap-one-pager.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print" });

// A wrong relative path fails silently in a browser: the page still draws, in
// Times and without colour. Refuse to write that.
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
  console.error(`The one-pager could not load ${missing.join(", ")}.`);
  process.exit(1);
}

const footBottom = await page.evaluate(
  () => document.querySelector(".foot")!.getBoundingClientRect().bottom,
);

await page.pdf({
  path: join(dir, "bindersnap-one-pager.pdf"),
  width: "8.5in",
  height: "11in",
  printBackground: true,
});
await page
  .locator(".page")
  .screenshot({ path: join(dir, "bindersnap-one-pager.png") });
await browser.close();

if (footBottom > 1056) {
  console.error(`The page overflows Letter by ${footBottom - 1056}px.`);
  process.exit(1);
}
console.log("Wrote bindersnap-one-pager.pdf and bindersnap-one-pager.png");
