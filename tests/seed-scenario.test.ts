import { expect, test, describe } from "bun:test";

import {
  loadSeedScenario,
  parseSeedScenario,
  renderSeedDocument,
  type SeedScenario,
} from "./seed-scenario";

/**
 * A scenario around one binder, so a fixture only says what it is testing.
 *
 * Every case below needs an organization and a binder to hang a document off —
 * ADR 0004's levels are not optional — and repeating that preamble eight times
 * buries the one line each test is actually about.
 */
function scenarioYaml(binderBody: string): string {
  return `
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
  - username: bob
    fullName: Bob Okafor
    email: bob@example.com
organization:
  name: mercy-health
  displayName: Mercy Health
  owner: alice
binders:
${binderBody}
`;
}

/** One binder holding one document, whose body the caller supplies. */
function oneDocument(documentBody: string): string {
  return `  - name: policies
    description: Policies
    members: []
    documents:
      - name: handbook
        description: Handbook
${documentBody}`;
}

const MINIMAL = `
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
organization:
  name: mercy-health
  displayName: Mercy Health
  owner: alice
binders: []
`;

const A_CHANGE = `        changes:
          - branch: upload/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            document:
              title: X
              sections:
                - paragraphs: ["One."]`;

describe("parseSeedScenario", () => {
  test("parses a minimal scenario", () => {
    const scenario = parseSeedScenario(MINIMAL);
    expect(scenario.password).toBe("dev");
    expect(scenario.users).toHaveLength(1);
    expect(scenario.users[0]?.username).toBe("alice");
    expect(scenario.binders).toEqual([]);
  });

  test("reads the organization that owns every binder", () => {
    const scenario = parseSeedScenario(MINIMAL);
    expect(scenario.organization).toEqual({
      name: "mercy-health",
      displayName: "Mercy Health",
      owner: "alice",
    });
  });

  test("defaults a document's format to the editor's own JSON", () => {
    const scenario = parseSeedScenario(scenarioYaml(oneDocument("")));
    expect(scenario.binders[0]?.documents[0]?.format).toBe("prosemirror");
  });

  test("a document may sit in a folder, or at the binder's root", () => {
    const scenario = parseSeedScenario(
      scenarioYaml(oneDocument("        folder: nursing")),
    );
    expect(scenario.binders[0]?.documents[0]?.folder).toBe("nursing");

    const rooted = parseSeedScenario(scenarioYaml(oneDocument("")));
    expect(rooted.binders[0]?.documents[0]?.folder).toBeUndefined();
  });

  test("rejects a file format nothing knows how to write", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(oneDocument("        format: powerpoint")),
      ),
    ).toThrow(/format/);
  });

  test("defaults a binder member's role to authors", () => {
    const scenario = parseSeedScenario(
      scenarioYaml(`  - name: policies
    description: Policies
    members:
      - user: bob
    documents: []`),
    );
    expect(scenario.binders[0]?.members[0]).toEqual({
      user: "bob",
      role: "authors",
    });
  });

  test("rejects a binder member who is not a declared user", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members:
      - user: bobby
    documents: []`),
      ),
    ).toThrow(/unknown user "bobby"/);
  });

  test("rejects a reviewer who is not a declared user", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          oneDocument(`${A_CHANGE}
            reviews:
              - by: bobby
                state: approved
                body: Fine.`),
        ),
      ),
    ).toThrow(/unknown user "bobby"/);
  });

  test("rejects a published change with no approving review", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          oneDocument(`        changes:
          - branch: upload/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            publish: true
            document:
              title: X
              sections:
                - paragraphs: ["One."]`),
        ),
      ),
    ).toThrow(/needs an approving review/);
  });

  test("rejects two documents at one path in a binder", () => {
    // A document's identity is its path, so two of them at one path are one
    // document — caught here rather than discovered as a silent overwrite.
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents:
      - name: handbook
        folder: hr
        description: Handbook
      - name: handbook
        folder: hr
        description: Handbook again`),
      ),
    ).toThrow(/duplicate document path "hr\/handbook"/);
  });

  test("the same name in two folders is two documents", () => {
    // The folder is part of the identity, so this is legitimate filing.
    const scenario = parseSeedScenario(
      scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents:
      - name: handbook
        folder: hr
        description: HR handbook
      - name: handbook
        folder: clinical
        description: Clinical handbook`),
    );
    expect(scenario.binders[0]?.documents).toHaveLength(2);
  });

  test("rejects duplicate binders", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents: []
  - name: policies
    description: Policies again
    members: []
    documents: []`),
      ),
    ).toThrow(/duplicate binder "policies"/);
  });

  test("rejects two documents proposing the same branch in one binder", () => {
    // A binder is one repository, so its branches are shared by every document
    // in it — the same branch twice is one change wearing two names.
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents:
      - name: handbook
        description: Handbook
${A_CHANGE}
      - name: manual
        description: Manual
${A_CHANGE}`),
      ),
    ).toThrow(/duplicate branch/);
  });

  test("rejects an unknown review state", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          oneDocument(`${A_CHANGE}
            reviews:
              - by: bob
                state: rubber_stamped
                body: Fine.`),
        ),
      ),
    ).toThrow(/expected one of approved, changes_requested, commented/);
  });

  test("rejects a change on a branch the workspace cannot see", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          oneDocument(`        changes:
          - branch: feature/x
            title: X
            summary: X
            document:
              title: X
              sections:
                - paragraphs: ["One."]`),
        ),
      ),
    ).toThrow(/must start with "upload/);
  });

  test("names the path of the offending field", () => {
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
organization:
  name: mercy-health
  displayName: Mercy Health
  owner: alice
binders: []
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

  const allDocuments = (seed: SeedScenario) =>
    seed.binders.flatMap((binder) => binder.documents);

  test("is valid and covers every workspace status", () => {
    expect(scenario.users.length).toBeGreaterThanOrEqual(4);
    expect(allDocuments(scenario).length).toBeGreaterThanOrEqual(5);

    const statuses = new Set(
      allDocuments(scenario).map((document) => {
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

  test("puts every binder under the one organization", () => {
    // ADR 0004: one organization per customer, and it owns every binder. The
    // dev stack should look like the product, not like a special case.
    expect(scenario.organization.name).toBe("mercy-health");
    expect(scenario.binders.length).toBeGreaterThanOrEqual(2);
  });

  test("exercises folders, which is the level that does the filing", () => {
    const foldered = allDocuments(scenario).filter(
      (document) => document.folder,
    );
    expect(foldered.length).toBeGreaterThan(0);
  });

  test("carries one policy in each file type the app can meet", () => {
    // Word, PDF, and Markdown, in the same house structure, so the preview
    // and comparison screens can be judged on the file type rather than on
    // the prose. Every one is published once and has a second version open,
    // which is what gives the comparison two sides to show.
    const manual = [
      { name: "infection-control-policy", format: "docx" },
      { name: "medication-administration-policy", format: "pdf" },
      { name: "patient-grievance-policy", format: "markdown" },
    ] as const;

    for (const { name, format } of manual) {
      const policy = allDocuments(scenario).find(
        (document) => document.name === name,
      );
      expect(policy?.format).toBe(format);
      expect(policy?.changes.filter((change) => change.publish)).toHaveLength(
        1,
      );
      expect(policy?.changes.filter((change) => !change.publish)).toHaveLength(
        1,
      );
    }
  });

  test("every other document is still the editor's own JSON", () => {
    const named = new Set([
      "infection-control-policy",
      "medication-administration-policy",
      "patient-grievance-policy",
    ]);

    for (const document of allDocuments(scenario)) {
      if (named.has(document.name)) continue;
      expect(document.format).toBe("prosemirror");
    }
  });

  test("keeps the fixtures the integration suite pins", () => {
    const report = allDocuments(scenario).find(
      (document) => document.name === "quarterly-report",
    );

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

    // Bob's access is the binder's now, not this document's: access is uniform
    // within a workspace, which is the whole reason the level exists.
    const binder = scenario.binders.find((candidate) =>
      candidate.documents.some(
        (document) => document.name === "quarterly-report",
      ),
    );
    expect(binder?.members.find((member) => member.user === "bob")?.role).toBe(
      "authors",
    );
  });
});
