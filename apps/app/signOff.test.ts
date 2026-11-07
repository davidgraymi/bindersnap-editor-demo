import { expect, test } from "bun:test";

import {
  buildSignOffChangeRows,
  describeSignOffChangeKind,
  summarizeSignOffChange,
} from "./signOff";
import type {
  SignOffDocumentView,
  SignOffRuleView,
} from "../../packages/api-schema/schemas/workspaces";

const documents: SignOffDocumentView[] = [
  {
    uid: "01J8XZ4K7MQ9V3B0RN7YHS2E1D",
    slugPath: "nursing/hand-hygiene",
    name: "hand-hygiene",
    folder: "nursing",
  },
];

const nursing: SignOffRuleView = {
  scope: "folder",
  target: "nursing",
  teams: ["infection-control"],
  users: [],
};

test("a rule taken away is said first, and said as a loosening", () => {
  const rows = buildSignOffChangeRows({
    base: [nursing],
    proposed: [
      { scope: "binder", target: "", teams: ["compliance"], users: [] },
    ],
    documents,
  });

  expect(rows.map((row) => row.kind)).toEqual(["removed", "added"]);
  expect(rows[0]).toMatchObject({
    target: "Anything filed in Nursing",
    from: "Infection Control",
    to: null,
    loosens: true,
  });
  expect(rows[1]).toMatchObject({
    target: "Everything in this binder",
    from: null,
    to: "Compliance",
    loosens: false,
  });
});

test("a rule changing hands says both halves", () => {
  const rows = buildSignOffChangeRows({
    base: [nursing],
    proposed: [{ ...nursing, teams: ["night-shift"], users: ["priya"] }],
    documents,
  });

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: "reassigned",
    from: "Infection Control",
    to: "Night Shift and priya",
    loosens: false,
  });
});

test("a rule about one document is named, not identified", () => {
  const rows = buildSignOffChangeRows({
    base: [],
    proposed: [
      {
        scope: "document",
        target: "01J8XZ4K7MQ9V3B0RN7YHS2E1D",
        teams: ["compliance"],
        users: [],
      },
    ],
    documents,
  });

  expect(rows[0]!.target).toBe("Hand Hygiene");
});

test("the line above the rows counts all three at once", () => {
  const rows = buildSignOffChangeRows({
    base: [
      nursing,
      { scope: "rules", target: "", teams: ["owners"], users: [] },
    ],
    proposed: [
      { ...nursing, teams: ["night-shift"] },
      { scope: "binder", target: "", teams: ["compliance"], users: [] },
    ],
    documents,
  });

  expect(summarizeSignOffChange(rows)).toBe(
    "1 rule taken away · 1 rule handed to somebody else · 1 rule added",
  );
});

test("a file that moved without a rule moving says so", () => {
  expect(summarizeSignOffChange([])).toBe(
    "This change rewrites the rules file without changing who signs anything off.",
  );
});

test("what a row did reads differently once the change is decided", () => {
  expect(describeSignOffChangeKind("removed")).toBe("Being taken away");
  expect(describeSignOffChangeKind("removed", false)).toBe("Taken away");
  expect(describeSignOffChangeKind("reassigned", false)).toBe("Changed hands");
  expect(describeSignOffChangeKind("added")).toBe("Being added");
});
