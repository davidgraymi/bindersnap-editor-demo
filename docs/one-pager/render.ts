/**
 * Renders the one-pager to the PDF and PNG beside it.
 *
 *   bun docs/one-pager/render.ts
 *
 * Exits non-zero if the page no longer fits on one US Letter sheet.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const dir = import.meta.dir;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 816, height: 1056 },
  deviceScaleFactor: 2.5,
});
await page.goto(`file://${join(dir, "bindersnap-one-pager.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: "print" });

const footBottom = await page.evaluate(
  () => document.querySelector(".foot")!.getBoundingClientRect().bottom,
);

await page.pdf({
  path: join(dir, "Bindersnap-One-Pager.pdf"),
  width: "8.5in",
  height: "11in",
  printBackground: true,
});
await page
  .locator(".page")
  .screenshot({ path: join(dir, "Bindersnap-One-Pager.png") });
await browser.close();

if (footBottom > 1056) {
  console.error(`The page overflows Letter by ${footBottom - 1056}px.`);
  process.exit(1);
}
console.log("Wrote Bindersnap-One-Pager.pdf and Bindersnap-One-Pager.png");
