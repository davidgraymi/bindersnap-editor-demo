import { expect, test } from "bun:test";

import {
  anchorFrom,
  clampQuote,
  CONTEXT_LENGTH,
  locateAnchor,
  QUOTE_LIMIT,
} from "./textAnchor";

const TEXT =
  "Standard class rail. First class is reimbursed only where it was cheaper than standard on the day. Alcohol is not reimbursed.";

test("an anchor is the words chosen and a few either side", () => {
  const start = TEXT.indexOf("cheaper than standard");
  const anchor = anchorFrom(
    TEXT,
    start,
    start + "cheaper than standard".length,
  );
  expect(anchor?.quote).toBe("cheaper than standard");
  expect(anchor?.prefix.endsWith("only where it was ")).toBe(true);
  expect(anchor?.suffix.startsWith(" on the day.")).toBe(true);
  expect(anchor!.prefix.length).toBeLessThanOrEqual(CONTEXT_LENGTH);
});

test("the spaces a dragged selection picks up are left off", () => {
  const start = TEXT.indexOf(" Alcohol");
  const anchor = anchorFrom(TEXT, start, start + " Alcohol is ".length);
  expect(anchor?.quote).toBe("Alcohol is");
});

test("a selection of nothing is no anchor, and backwards is the same passage", () => {
  expect(anchorFrom(TEXT, 5, 5)).toBeNull();
  expect(anchorFrom("a   b", 1, 4)).toBeNull();
  expect(anchorFrom(TEXT, 14, 0)?.quote).toBe("Standard class");
});

test("a very long selection keeps its opening words", () => {
  const long = "word ".repeat(400);
  expect(anchorFrom(long, 0, long.length)?.quote.length).toBe(QUOTE_LIMIT);
});

test("the words are found again where they were", () => {
  const start = TEXT.indexOf("cheaper than standard");
  const anchor = anchorFrom(TEXT, start, start + 21)!;
  expect(locateAnchor(TEXT, anchor)).toEqual({ start, end: start + 21 });
  // And after the document has grown above them.
  const grown = `A new opening paragraph. ${TEXT}`;
  expect(locateAnchor(grown, anchor)?.start).toBe(start + 25);
});

test("words said twice are found by what stands beside them", () => {
  const twice =
    "The manager approves. Later, the director approves. Then the manager approves again.";
  const second = twice.lastIndexOf("approves");
  const anchor = anchorFrom(twice, second, second + "approves".length)!;
  expect(locateAnchor(twice, anchor)?.start).toBe(second);
  const middle = twice.indexOf("approves", twice.indexOf("director"));
  expect(
    locateAnchor(twice, anchorFrom(twice, middle, middle + 8)!)?.start,
  ).toBe(middle);
});

test("words that were rewritten are not found", () => {
  const start = TEXT.indexOf("cheaper than standard");
  const anchor = anchorFrom(TEXT, start, start + 21)!;
  expect(
    locateAnchor(
      TEXT.replace("cheaper than standard", "the lower fare"),
      anchor,
    ),
  ).toBeNull();
});

test("a long passage is shown by its opening words", () => {
  expect(clampQuote("  two\n  lines ")).toBe("two lines");
  expect(clampQuote("word ".repeat(60)).endsWith("…")).toBe(true);
  expect(clampQuote("word ".repeat(60)).length).toBeLessThanOrEqual(140);
});
