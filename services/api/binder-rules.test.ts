import { describe, expect, test } from "bun:test";

import { parseBinderRulesRequest } from "./server";

describe("parseBinderRulesRequest", () => {
  test("takes any one rule on its own", () => {
    expect(parseBinderRulesRequest({ requiredApprovals: 0 })).toEqual({
      requiredApprovals: 0,
    });
    expect(parseBinderRulesRequest({ dismissStaleApprovals: false })).toEqual({
      dismissStaleApprovals: false,
    });
    expect(parseBinderRulesRequest({ blockOnUnresolvedThreads: true })).toEqual(
      { blockOnUnresolvedThreads: true },
    );
  });

  test("refuses a request that changes nothing", () => {
    expect(typeof parseBinderRulesRequest({})).toBe("string");
    expect(typeof parseBinderRulesRequest(null)).toBe("string");
  });

  test("refuses an approval count that is not a whole number from 0 to 10", () => {
    for (const count of [-1, 11, 1.5, "2", null]) {
      expect(typeof parseBinderRulesRequest({ requiredApprovals: count })).toBe(
        "string",
      );
    }
  });
});
