import { expect, test } from "bun:test";

import { dateChoices } from "./options";

test("today in the ways a policy writes a date, ISO last", () => {
  const day = new Date(2026, 8, 27);
  const choices = dateChoices(day, "en-GB");
  expect(choices).toHaveLength(5);
  expect(choices[0]).toBe("27 September 2026");
  // The weekday and the short month are punctuated by ICU, which varies.
  expect(choices[1]).toContain("Sunday");
  expect(choices[1]).toContain("27 September 2026");
  expect(choices[2]).toMatch(/^27 Sept?\.? 2026$/);
  expect(choices[3]).toBe("September 2026");
  expect(choices[4]).toBe("2026-09-27");
  expect(dateChoices(day, "en-US")[0]).toBe("September 27, 2026");
});

test("a single-digit day and month are padded in the ISO form", () => {
  expect(dateChoices(new Date(2027, 0, 5), "en-GB").at(-1)).toBe("2027-01-05");
});
