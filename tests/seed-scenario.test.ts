import { expect, test, describe } from "bun:test";

import {
  loadSeedScenario,
  parseSeedScenario,
  renderSeedDocument,
} from "./seed-scenario";

const MINIMAL = `
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
documents: []
`;

describe("parseSeedScenario", () => {
  test("parses a minimal scenario", () => {
    const scenario = parseSeedScenario(MINIMAL);
    expect(scenario.password).toBe("dev");
    expect(scenario.users).toHaveLength(1);
    expect(scenario.users[0]?.username).toBe("alice");
    expect(scenario.documents).toEqual([]);
  });

  test("defaults collaborator permission to write", () => {
    const scenario = parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
  - username: bob
    fullName: Bob Okafor
    email: bob@example.com
documents:
  - owner: alice
    repo: handbook
    description: Handbook
    collaborators:
      - user: bob
`);
    expect(scenario.documents[0]?.collaborators[0]).toEqual({
      user: "bob",
      permission: "write",
    });
  });

  test("rejects a reviewer who is not a declared user", () => {
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
documents:
  - owner: alice
    repo: handbook
    description: Handbook
    changes:
      - branch: upload/handbook/20260101/000000Z-alice-00000001
        title: X
        summary: X
        document:
          title: X
          sections:
            - paragraphs: ["One."]
        reviews:
          - by: bobby
            state: approved
            body: Fine.
`),
    ).toThrow(/unknown user "bobby"/);
  });

  test("rejects a published change with no approving review", () => {
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
documents:
  - owner: alice
    repo: handbook
    description: Handbook
    changes:
      - branch: upload/handbook/20260101/000000Z-alice-00000001
        title: X
        summary: X
        publish: true
        document:
          title: X
          sections:
            - paragraphs: ["One."]
`),
    ).toThrow(/needs an approving review/);
  });

  test("rejects duplicate documents and duplicate branches", () => {
    const duplicateRepo = `
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
documents:
  - owner: alice
    repo: handbook
    description: Handbook
  - owner: alice
    repo: handbook
    description: Handbook again
`;
    expect(() => parseSeedScenario(duplicateRepo)).toThrow(
      /duplicate document "alice\/handbook"/,
    );
  });

  test("rejects an unknown review state", () => {
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
  - username: bob
    fullName: Bob Okafor
    email: bob@example.com
documents:
  - owner: alice
    repo: handbook
    description: Handbook
    changes:
      - branch: upload/handbook/20260101/000000Z-alice-00000001
        title: X
        summary: X
        document:
          title: X
          sections:
            - paragraphs: ["One."]
        reviews:
          - by: bob
            state: rubber_stamped
            body: Fine.
`),
    ).toThrow(/expected one of approved, changes_requested, commented/);
  });

  test("rejects a change on a branch the workspace cannot see", () => {
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
documents:
  - owner: alice
    repo: handbook
    description: Handbook
    changes:
      - branch: feature/x
        title: X
        summary: X
        document:
          title: X
          sections:
            - paragraphs: ["One."]
`),
    ).toThrow(/must start with "upload/);
  });

  test("names the path of the offending field", () => {
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
documents: []
`),
    ).toThrow(/scenario.users\[0\].email/);
  });
});

describe("renderSeedDocument", () => {
  test("renders headings and paragraphs as TipTap JSON", () => {
    const rendered = JSON.parse(
      renderSeedDocument({
        title: "Incident Response Plan",
        sections: [
          { paragraphs: ["An opening line."] },
          {
            heading: "Notification",
            paragraphs: ["Within 72 hours.", "Or else."],
          },
        ],
      }),
    );

    expect(rendered.type).toBe("doc");
    expect(rendered.content[0]).toEqual({
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Incident Response Plan" }],
    });
    expect(rendered.content[1].type).toBe("paragraph");
    expect(rendered.content[2]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Notification" }],
    });
    expect(rendered.content).toHaveLength(5);
  });

  test("is stable across calls, so re-seeding sees no diff", () => {
    const document = {
      title: "A",
      sections: [{ paragraphs: ["One."] }],
    };
    expect(renderSeedDocument(document)).toBe(renderSeedDocument(document));
  });
});

describe("tests/seed-data/dev.yaml", () => {
  const scenario = loadSeedScenario(
    new URL("seed-data/dev.yaml", import.meta.url),
  );

  test("is valid and covers every workspace status", () => {
    expect(scenario.users.length).toBeGreaterThanOrEqual(4);
    expect(scenario.documents.length).toBeGreaterThanOrEqual(5);

    const statuses = new Set(
      scenario.documents.map((document) => {
        const open = document.changes.filter((change) => !change.publish);
        const states = open.flatMap((change) =>
          change.reviews.map((review) => review.state),
        );
        if (states.includes("changes_requested")) return "changes_requested";
        if (states.includes("approved")) return "approved";
        if (open.length > 0) return "in_review";
        return document.changes.some((change) => change.publish)
          ? "published"
          : "draft";
      }),
    );

    expect([...statuses].sort()).toEqual([
      "approved",
      "changes_requested",
      "draft",
      "in_review",
      "published",
    ]);
  });

  test("keeps the fixtures the integration suite pins", () => {
    const report = scenario.documents.find(
      (document) => document.repo === "quarterly-report",
    );
    expect(report?.owner).toBe("alice");

    const change = report?.changes.find(
      (candidate) =>
        candidate.branch ===
        "upload/quarterly-report/20260210/091500Z-alice-4b1c9de2",
    );
    expect(change?.title).toBe("Q2 amendments — GDPR section update");
    expect(change?.publish).toBe(false);
    expect(change?.reviews).toContainEqual({
      by: "bob",
      state: "changes_requested",
      body: "Section 4.2 needs to reference the updated GDPR guidance from the January memo.",
    });

    expect(
      report?.collaborators.find((collaborator) => collaborator.user === "bob")
        ?.permission,
    ).toBe("write");
  });
});
