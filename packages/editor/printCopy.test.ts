import { afterEach, describe, expect, test } from "bun:test";

import {
  PRINTING_CLASS,
  cssString,
  pageMarginRules,
  preparePrintCopy,
  removePrintCopy,
} from "./printCopy";

describe("printing a policy", () => {
  afterEach(removePrintCopy);

  test("its name is a safe CSS string, whatever it is called", () => {
    expect(cssString('Staff "on call" rota')).toBe(
      '"Staff \\"on call\\" rota"',
    );
    expect(cssString("Back\\slash\nand line")).toBe('"Back\\\\slash and line"');
    expect(pageMarginRules("Hand Hygiene")).toContain(
      '@top-left {\n      content: "Hand Hygiene";',
    );
    expect(pageMarginRules("x")).toContain(
      'counter(page) " of " counter(pages)',
    );
  });

  test("the copy goes straight under body, and all of it comes off again", () => {
    preparePrintCopy("<h1>Hand Hygiene</h1><p>Wash.</p>", "Hand Hygiene");
    const root = document.body.querySelector(":scope > .bs-print-root");
    expect(root?.querySelector(".bs-doc-content h1")?.textContent).toBe(
      "Hand Hygiene",
    );
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(
      true,
    );

    // Printing twice does not leave two copies.
    preparePrintCopy("<p>Again</p>", "Hand Hygiene");
    expect(document.querySelectorAll(".bs-print-root")).toHaveLength(1);

    removePrintCopy();
    expect(document.querySelector(".bs-print-root")).toBeNull();
    expect(document.getElementById("bs-print-margins")).toBeNull();
    expect(document.documentElement.classList.contains(PRINTING_CLASS)).toBe(
      false,
    );
  });
});
