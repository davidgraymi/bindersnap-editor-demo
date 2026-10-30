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

  test("takes the groups and people whose approvals count", () => {
    expect(
      parseBinderRulesRequest({
        requiredApprovals: 3,
        approvers: { groups: ["board", "board"], people: [" dr-okafor "] },
      }),
    ).toEqual({
      requiredApprovals: 3,
      approvers: { groups: ["board"], people: ["dr-okafor"] },
    });
    expect(
      parseBinderRulesRequest({ approvers: { groups: ["board"] } }),
    ).toEqual({ approvers: { groups: ["board"], people: [] } });
  });

  test("takes an empty list of approvers, as Gitea does", () => {
    // Nobody's approval counts. A binder needing none is unaffected; one
    // needing approvals publishes nothing until its admin names approvers.
    expect(
      parseBinderRulesRequest({ approvers: { groups: [], people: [] } }),
    ).toEqual({ approvers: { groups: [], people: [] } });
  });

  test("refuses approvers that are not lists of names", () => {
    for (const approvers of [
      "board",
      3,
      { groups: "board" },
      { people: [""] },
    ]) {
      expect(typeof parseBinderRulesRequest({ approvers })).toBe("string");
    }
  });
});
