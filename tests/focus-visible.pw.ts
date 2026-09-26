import { expect, test, type Page } from "@playwright/test";

import { signInAsAlice } from "./helpers";

/**
 * Everything the keyboard can reach shows that it has been reached.
 *
 * Focus styles are written control by control, so a control that sets
 * `outline: none` and forgets the replacement is invisible to review. The page
 * tabs did exactly that: focus turned their text the darker colour, which the
 * active tab already was, so tabbing onto it changed nothing on screen.
 *
 * Measured, not reviewed: tab through each page and ask every stop whether it
 * draws an outline or a shadow.
 */

const PAGES = [
  "/",
  "/changes",
  "/riverside-health",
  "/riverside-health?tab=people",
  "/riverside-health/corporate",
  "/riverside-health/corporate?tab=changes&change=16",
];

/** How many Tab presses to spend on a page — enough to leave the shell. */
const STOPS = 60;

async function unmarkedStops(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const unmarked = new Set<string>();

  for (let i = 0; i < STOPS; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const marked =
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== "none";
      const label = (
        element.getAttribute("aria-label") ||
        element.textContent ||
        ""
      )
        .trim()
        .slice(0, 40);
      return marked
        ? null
        : `${element.tagName.toLowerCase()}.${[...element.classList].join(".")} "${label}"`;
    });
    if (stop) unmarked.add(stop);
  }

  return [...unmarked].map((stop) => `${path}: ${stop}`);
}

test("every keyboard stop on the main pages shows a focus ring", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInAsAlice(page);

  const unmarked: string[] = [];
  for (const path of PAGES) {
    unmarked.push(...(await unmarkedStops(page, path)));
  }

  expect(unmarked, "reached by Tab, but nothing on screen says so").toEqual([]);
});
