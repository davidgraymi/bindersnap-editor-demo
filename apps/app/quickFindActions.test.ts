import { describe, expect, test } from "bun:test";

import {
  listQuickFindActions,
  matchQuickFindActions,
  type QuickFindActionContext,
} from "./quickFindActions";

/** Signed in, on no organization's page yet. */
const nowhere: QuickFindActionContext = {
  org: null,
  orgName: "",
  binder: null,
  isSiteAdmin: false,
  theme: "light",
  sidebarCollapsed: false,
  canSendFeedback: false,
  canShowGuide: false,
};

/** Inside a binder, with everything on offer. */
const inClinical: QuickFindActionContext = {
  ...nowhere,
  org: "riverside-health",
  orgName: "Riverside Health",
  binder: { org: "riverside-health", binder: "clinical", name: "Clinical" },
  canSendFeedback: true,
};

function first(context: QuickFindActionContext, query: string) {
  return matchQuickFindActions(listQuickFindActions(context), query, 5)[0];
}

function names(context: QuickFindActionContext, query: string) {
  return matchQuickFindActions(listQuickFindActions(context), query, 5).map(
    (action) => action.name,
  );
}

describe("what a word finds", () => {
  test("“help” finds Help and guides first, then the guides", () => {
    const found = matchQuickFindActions(
      listQuickFindActions(nowhere),
      "help",
      5,
    );
    expect(found[0]!.name).toBe("Help and guides");
    expect(found[0]!.target).toEqual({ kind: "link", href: "/help" });
    expect(found.slice(1).every((a) => a.meta.startsWith("Help guide"))).toBe(
      true,
    );
  });

  test("billing is found by its name and by what people call it", () => {
    for (const query of ["billing", "bill", "plan", "subscription", "card"]) {
      expect(first(inClinical, query)?.name).toBe("Billing");
    }
    expect(first(inClinical, "billing")!.target).toEqual({
      kind: "route",
      route: { kind: "billing", org: "riverside-health" },
    });
  });

  test("the theme says which way it will switch", () => {
    expect(first(nowhere, "dark")!.name).toBe("Switch to the dark theme");
    expect(first({ ...nowhere, theme: "dark" }, "theme")!.name).toBe(
      "Switch to the light theme",
    );
  });

  test("the sidebar says which way it will go, and is absent without one", () => {
    expect(first(nowhere, "collapse")!.name).toBe("Collapse the navigation");
    expect(first({ ...nowhere, sidebarCollapsed: true }, "sidebar")!.name).toBe(
      "Expand the navigation",
    );
    expect(names({ ...nowhere, sidebarCollapsed: null }, "sidebar")).toEqual(
      [],
    );
  });

  test("people & access is the organization's and the binder's", () => {
    const found = matchQuickFindActions(
      listQuickFindActions(inClinical),
      "people",
      5,
    );
    expect(found.map((a) => a.id).slice(0, 2)).toEqual([
      "org-people",
      "binder-people",
    ]);
    expect(found[1]!.target).toEqual({
      kind: "route",
      route: {
        kind: "binder",
        org: "riverside-health",
        binder: "clinical",
        tab: "people",
      },
    });
  });

  test("binders, approvers and history are all reachable", () => {
    expect(first(inClinical, "binders")!.name).toBe("Binders");
    expect(first(inClinical, "approvers")!.id).toBe("binder-approvals");
    expect(first(inClinical, "history")!.id).toBe("binder-history");
  });

  test("words count from their start, so a fragment does not match half the menu", () => {
    expect(names(inClinical, "ven")).toEqual([]);
    expect(names(inClinical, "zzz")).toEqual([]);
  });

  test("several words each have to start a word", () => {
    expect(first(inClinical, "sign out")!.name).toBe("Sign out");
    expect(first(inClinical, "log out")!.name).toBe("Sign out");
  });
});

describe("what is on offer depends on where you are", () => {
  test("without an organization there is nothing organization-shaped", () => {
    const ids = listQuickFindActions(nowhere).map((a) => a.id);
    expect(ids).not.toContain("org-people");
    expect(ids).not.toContain("new-binder");
    expect(ids).not.toContain("binder-history");
  });

  test("only a site admin is offered the console", () => {
    expect(names(nowhere, "admin")).not.toContain("Site admin");
    expect(first({ ...nowhere, isSiteAdmin: true }, "admin")!.name).toBe(
      "Site admin",
    );
  });

  test("feedback only where it can be sent", () => {
    expect(names(nowhere, "feedback")).toEqual([]);
    expect(first(inClinical, "feedback")!.target).toEqual({
      kind: "command",
      command: "sendFeedback",
    });
  });

  test("every action has its own id", () => {
    const ids = listQuickFindActions({
      ...inClinical,
      isSiteAdmin: true,
      canShowGuide: true,
    }).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
