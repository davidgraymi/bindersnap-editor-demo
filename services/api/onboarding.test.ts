import { describe, expect, test } from "bun:test";

import { onboardingState } from "./onboarding";

const binder = (extra: object = {}) => ({
  name: "policies",
  hasDocuments: false,
  hasPublished: false,
  requiredApprovals: 1,
  ...extra,
});

describe("onboardingState", () => {
  test("somebody with nothing yet starts at the organization", () => {
    const state = onboardingState([]);
    expect(state.steps.map((step) => step.done)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(state.steps[0]!.href).toBe("/organizations/new");
    expect(state.steps[1]!.href).toBeNull();
  });

  test("each step reads what exists, and links into the right binder", () => {
    const state = onboardingState([
      {
        name: "mercy",
        hasColleagues: false,
        binders: [binder({ hasDocuments: true })],
      },
    ]);
    expect(state.steps.map((step) => [step.id, step.done])).toEqual([
      ["organization", true],
      ["binder", true],
      ["documents", true],
      ["approvers", false],
      ["publish", false],
    ]);
    expect(state.steps.find((step) => step.id === "documents")!.href).toBe(
      "/mercy/policies?add=1",
    );
  });

  test("working alone counts as deciding who approves", () => {
    const state = onboardingState([
      {
        name: "mercy",
        hasColleagues: false,
        binders: [binder({ requiredApprovals: 0 })],
      },
    ]);
    expect(state.steps.find((step) => step.id === "approvers")!.done).toBe(
      true,
    );
  });

  test("the organization furthest along is the one guided", () => {
    const state = onboardingState([
      { name: "empty", hasColleagues: false, binders: [] },
      {
        name: "real",
        hasColleagues: true,
        binders: [binder({ hasDocuments: true, hasPublished: true })],
      },
    ]);
    expect(state.org).toBe("real");
    expect(state.complete).toBe(true);
  });
});

test("somebody who can see a published version is past setting up", () => {
  expect(onboardingState([], { published: true }).complete).toBe(true);
});
