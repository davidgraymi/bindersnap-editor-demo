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

  test("takes any whole number of approvals Gitea can store", () => {
    for (const count of [0, 11, 99, 1000, Number.MAX_SAFE_INTEGER]) {
      expect(parseBinderRulesRequest({ requiredApprovals: count })).toEqual({
        requiredApprovals: count,
      });
    }
  });

  test("refuses an approval count that is not a whole number, 0 or more", () => {
    for (const count of [-1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(typeof parseBinderRulesRequest({ requiredApprovals: count })).toBe(
        "string",
      );
    }
  });
});
