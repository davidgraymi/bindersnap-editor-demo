import { describe, expect, test } from "bun:test";

import {
  errorFingerprint,
  fingerprintText,
  scrubErrorText,
} from "./errorReport";

const scrub = (text: string) => scrubErrorText(text, 10_000);

describe("scrubErrorText", () => {
  test("emails go", () => {
    expect(scrub("No account for alice.doe+x@riverside.health")).toBe(
      "No account for [email]",
    );
  });

  test("a page's path and query go, and its origin stays", () => {
    expect(
      scrub(
        "Failed: https://app.bindersnap.com/riverside/clinical/-/blob/main/intake.md?q=jane",
      ),
    ).toBe("Failed: https://app.bindersnap.com/[path]");
  });

  test("a script's path and position stay, so a stack still reads", () => {
    expect(
      scrub("at render (https://app.bindersnap.com/chunk-a1b2c3.js:1:20345)"),
    ).toBe("at render (https://app.bindersnap.com/chunk-a1b2c3.js:1:20345)");
  });

  test("phone, SSN and long numbers go; short ones stay", () => {
    expect(
      scrub("call 555-123-4567 or 123-45-6789, MRN 00412345, row 12"),
    ).toBe("call [number] or [number], MRN [number], row 12");
  });

  test("tokens go", () => {
    expect(scrub("bad token 3f2a9c1e7b6d4a5f8e9c0b1a2d3e4f5a6b")).toBe(
      "bad token [token]",
    );
  });

  test("quoted phrases go; a quoted property name stays", () => {
    expect(
      scrub(
        `Cannot read properties of undefined (reading 'title') in "Jane Doe intake"`,
      ),
    ).toBe(`Cannot read properties of undefined (reading 'title') in "…"`);
    expect(scrub("Document “Hand hygiene” is locked")).toBe(
      "Document “…” is locked",
    );
  });

  test("cut to the limit", () => {
    expect(scrubErrorText("x".repeat(50), 10)).toBe("x".repeat(10));
  });
});

describe("errorFingerprint", () => {
  const base = { source: "app" as const, kind: "TypeError" };

  test("the same for two occurrences that differ only in numbers and IDs", async () => {
    const one = await errorFingerprint({
      ...base,
      message: "Change 12 failed at commit 3f2a9c1e on row 4",
    });
    const two = await errorFingerprint({
      ...base,
      message: "Change 873 failed at commit 77b0d2aa on row 19",
    });
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{12}$/);
  });

  test("different for a different error", async () => {
    const one = await errorFingerprint({ ...base, message: "x is undefined" });
    const two = await errorFingerprint({ ...base, message: "y is undefined" });
    const api = await errorFingerprint({
      ...base,
      source: "api",
      message: "x is undefined",
    });
    expect(new Set([one, two, api]).size).toBe(3);
  });

  test("what it is made of", () => {
    expect(
      fingerprintText({ ...base, message: "Got   404 for jane@x.org" }),
    ).toBe("app\nTypeError\nGot 0 for [email]");
  });
});
