import { describe, expect, test } from "bun:test";

import {
  isStripeEventForThisRun,
  stripeObjectRunTag,
  stripeRunTagMetadata,
} from "./run-tag";

describe("stripeObjectRunTag", () => {
  test("reads a checkout session's or subscription's own metadata", () => {
    expect(stripeObjectRunTag({ metadata: { bindersnap_run: "run-a" } })).toBe(
      "run-a",
    );
  });

  test("reads an invoice's subscription metadata on either API shape", () => {
    expect(
      stripeObjectRunTag({
        metadata: {},
        parent: {
          subscription_details: { metadata: { bindersnap_run: "run-b" } },
        },
      }),
    ).toBe("run-b");
    expect(
      stripeObjectRunTag({
        subscription_details: { metadata: { bindersnap_run: "run-c" } },
      }),
    ).toBe("run-c");
  });

  test("is null for an object that carries no tag", () => {
    expect(stripeObjectRunTag({})).toBeNull();
    expect(stripeObjectRunTag({ metadata: { bindersnap_run: "" } })).toBeNull();
    expect(stripeObjectRunTag(null)).toBeNull();
  });
});

describe("isStripeEventForThisRun", () => {
  test("accepts everything when no run tag is configured", () => {
    expect(isStripeEventForThisRun({}, "")).toBe(true);
    expect(
      isStripeEventForThisRun({ metadata: { bindersnap_run: "other" } }, ""),
    ).toBe(true);
  });

  test("accepts only this run's objects when a tag is configured", () => {
    const mine = { metadata: { bindersnap_run: "mine" } };
    expect(isStripeEventForThisRun(mine, "mine")).toBe(true);
    expect(
      isStripeEventForThisRun(
        { metadata: { bindersnap_run: "theirs" } },
        "mine",
      ),
    ).toBe(false);
    // Untagged: made by somebody else sharing the account.
    expect(isStripeEventForThisRun({ metadata: {} }, "mine")).toBe(false);
  });
});

describe("stripeRunTagMetadata", () => {
  test("stamps the tag, or nothing when there is none", () => {
    expect(stripeRunTagMetadata("run-a")).toEqual({ bindersnap_run: "run-a" });
    expect(stripeRunTagMetadata("")).toEqual({});
  });
});
