import { describe, expect, test } from "bun:test";

import type { BinderSignOffPayload } from "../../packages/api-schema/schemas/workspaces";
import { buildSignOffPanel, withOwner, withoutOwner } from "./signOffPanel";

const HAND = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const HAND_PATH = `clinical-standards/hand-hygiene.${HAND}.json`;

const payload: BinderSignOffPayload = {
  organization: "riverside-health",
  workspace: "governance",
  ref: "main",
  rules: [
    { scope: "binder", target: "", teams: ["policy-office"], users: [] },
    {
      scope: "folder",
      target: "clinical-standards",
      teams: ["infection-control"],
      users: [],
    },
    { scope: "folder", target: "contracts", teams: [], users: ["priya"] },
    { scope: "rules", target: "", teams: ["policy-office"], users: [] },
  ],
  unreadable: [],
  requiredApprovals: 2,
  approvers: { groups: ["policy-office"], people: [] },
  groups: [
    {
      name: "infection-control",
      description: "",
      members: [{ login: "grace", fullName: "Grace Ibori", hasAccess: true }],
      hasAccess: true,
    },
    {
      name: "policy-office",
      description: "",
      members: [
        { login: "alice", fullName: "Alice Nguyen", hasAccess: true },
        { login: "priya", fullName: "Priya Raman", hasAccess: true },
      ],
      hasAccess: true,
    },
  ],
  people: [{ login: "priya", fullName: "Priya Raman", hasAccess: true }],
  documents: [{ path: HAND_PATH, uid: HAND, name: "hand-hygiene" }],
  canEdit: true,
};

describe("a folder's panel", () => {
  const view = buildSignOffPanel({
    payload,
    place: { kind: "folder", path: "clinical-standards" },
    binderName: "Governance",
  });

  test("its own rule is set here, the binder's comes from above", () => {
    expect(view.here.map((row) => row.title)).toEqual(["Infection Control"]);
    expect(view.here[0]!.detail).toBe("Set on this folder");
    expect(view.above.map((row) => row.title)).toEqual([
      "Policy Office",
      "2 approvals",
    ]);
    expect(view.above[0]!.origin).toEqual({
      label: "Governance",
      to: { kind: "binder" },
    });
  });

  test("leads with what the folder needs, and says how to change it", () => {
    expect(view.lead).toBe(
      "Publishing anything in this folder needs one approval from each of these.",
    );
    expect(view.foot).toBe(
      "To change who signs off here, press Edit. It goes into a draft, and the Policy Office approves it.",
    );
  });

  test("in the editor it says will need, and has no foot", () => {
    const editing = buildSignOffPanel({
      payload,
      place: { kind: "folder", path: "clinical-standards" },
      binderName: "Governance",
      editing: true,
    });
    expect(editing.lead).toContain("will need");
    expect(editing.foot).toBeNull();
  });
});

describe("a document's panel", () => {
  test("with nothing of its own, everything is from above", () => {
    const view = buildSignOffPanel({
      payload,
      place: { kind: "document", path: HAND_PATH },
      binderName: "Governance",
    });
    expect(view.here).toEqual([]);
    expect(view.hereEmpty).toBe("Nothing is set on this document alone.");
    expect(view.above[0]!.origin).toEqual({
      label: "Clinical Standards",
      to: { kind: "folder", path: "clinical-standards" },
    });
    expect(view.ownTarget).toEqual({ scope: "document", target: HAND });
  });
});

describe("the binder's panel", () => {
  const view = buildSignOffPanel({
    payload,
    place: { kind: "binder" },
    binderName: "Governance",
  });

  test("sets the binder rule, the approvals and the rules rule here", () => {
    expect(view.here.map((row) => `${row.title} · ${row.detail}`)).toEqual([
      "Policy Office · The whole binder",
      "2 approvals · From the binder's approvers",
      "Policy Office · Any change to who signs off",
    ]);
    expect(view.above).toEqual([]);
  });

  test("names the places that add rules of their own", () => {
    expect(view.foot).toBe(
      "Clinical Standards and Contracts add rules of their own. Open them to see.",
    );
  });
});

describe("a group that cannot read the binder", () => {
  test("is marked on its row", () => {
    const view = buildSignOffPanel({
      payload: {
        ...payload,
        groups: payload.groups.map((group) =>
          group.name === "infection-control"
            ? { ...group, hasAccess: false }
            : group,
        ),
      },
      place: { kind: "folder", path: "clinical-standards" },
      binderName: "Governance",
    });
    expect(view.here[0]!.hasAccess).toBe(false);
  });
});

describe("editing a rule", () => {
  test("adds an owner to this place's rule, making it if needed", () => {
    expect(
      withOwner(
        null,
        { scope: "folder", target: "hr" },
        {
          kind: "team",
          name: "quality",
        },
      ),
    ).toEqual({ scope: "folder", target: "hr", teams: ["quality"], users: [] });
  });

  test("removes one owner and leaves the rest", () => {
    expect(
      withoutOwner(
        { scope: "folder", target: "hr", teams: ["a", "b"], users: ["c"] },
        { kind: "team", name: "a" },
      ),
    ).toEqual({ scope: "folder", target: "hr", teams: ["b"], users: ["c"] });
  });
});
