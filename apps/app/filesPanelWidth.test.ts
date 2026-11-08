import { describe, expect, test } from "bun:test";

import {
  FILES_WIDTH_DEFAULT,
  FILES_WIDTH_MAX,
  FILES_WIDTH_MIN,
  FILES_WIDTH_STEP,
  clampFilesWidth,
  keyedFilesWidth,
} from "./filesPanelWidth";

describe("clampFilesWidth", () => {
  test("keeps a width between the ends, rounded", () => {
    expect(clampFilesWidth(300.4)).toBe(300);
  });

  test("stops at either end", () => {
    expect(clampFilesWidth(10)).toBe(FILES_WIDTH_MIN);
    expect(clampFilesWidth(5000)).toBe(FILES_WIDTH_MAX);
  });

  test("falls back to the default for what is not a number", () => {
    expect(clampFilesWidth(Number("wide"))).toBe(FILES_WIDTH_DEFAULT);
  });
});

describe("keyedFilesWidth", () => {
  test("the arrows step the width", () => {
    expect(keyedFilesWidth("ArrowRight", 300)).toBe(300 + FILES_WIDTH_STEP);
    expect(keyedFilesWidth("ArrowLeft", 300)).toBe(300 - FILES_WIDTH_STEP);
  });

  test("an arrow stops at the end", () => {
    expect(keyedFilesWidth("ArrowLeft", FILES_WIDTH_MIN)).toBe(FILES_WIDTH_MIN);
  });

  test("Home and End go to either end", () => {
    expect(keyedFilesWidth("Home", 300)).toBe(FILES_WIDTH_MIN);
    expect(keyedFilesWidth("End", 300)).toBe(FILES_WIDTH_MAX);
  });

  test("other keys are left alone", () => {
    expect(keyedFilesWidth("Enter", 300)).toBeNull();
  });
});
