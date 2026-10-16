import { describe, expect, test } from "bun:test";

import { describeNotification } from "./notificationText";

describe("describeNotification", () => {
  test("says whose desk it is on", () => {
    expect(
      describeNotification({ reason: "review_requested", actor: "carol" }),
    ).toBe("carol asked for your review");
    expect(describeNotification({ reason: "published", actor: null })).toBe(
      "Published",
    );
    expect(
      describeNotification(
        { reason: "activity", actor: "bob" },
        () => "Bob Okafor",
      ),
    ).toBe("New activity on Bob Okafor’s change");
  });
});
