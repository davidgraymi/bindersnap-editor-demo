import { expect, test, describe } from "bun:test";

import {
  binderDocumentSlugPath,
  loadSeedScenario,
  parseSeedScenario,
  renderSeedDocument,
  SEED_DOCUMENT_FORMATS,
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
      owners: [],
      groups: [],
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

  // -------------------------------------------------------------------------
  // The cross-checks that catch a scenario which seeds *successfully* and
  // leaves the stack quietly wrong. Each of these once cost, or would have
  // cost, ten seconds of merge retries and an error in Gitea's words rather
  // than a line number in this file.
  // -------------------------------------------------------------------------

  test("rejects an approval from somebody who may review but not publish", () => {
    // With the approvals whitelist off — which is how the seed leaves every
    // binder — Gitea resolves "official reviewer" as write or better. A
    // reviewer's approval is recorded, displayed, and satisfies nothing, so
    // the merge waits forever on a change that looks approved.
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members:
      - user: bob
        role: reviewers
    documents:
      - name: handbook
        description: Handbook
        changes:
          - branch: upload/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            author: alice
            publish: true
            document:
              title: X
              sections:
                - paragraphs: ["One."]
            reviews:
              - by: bob
                state: approved
                body: Fine.`),
      ),
    ).toThrow(/may review here but not publish/);
  });

  test("rejects a change approved by its own author", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          oneDocument(`        changes:
          - branch: upload/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            author: alice
            publish: true
            document:
              title: X
              sections:
                - paragraphs: ["One."]
            reviews:
              - by: alice
                state: approved
                body: Fine.`),
        ),
      ),
    ).toThrow(/approval of your own/);
  });

  test("rejects a published change short of the binder's approval count", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    requiredApprovals: 2
    members:
      - user: bob
        role: authors
    documents:
      - name: handbook
        description: Handbook
        changes:
          - branch: upload/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            author: alice
            publish: true
            document:
              title: X
              sections:
                - paragraphs: ["One."]
            reviews:
              - by: bob
                state: approved
                body: Fine.`),
      ),
    ).toThrow(/requires 2 approvals/);
  });

  test("rejects putting somebody outside the organization on a binder", () => {
    // Adding an account to any of the org's teams makes it a member, so this
    // scenario would quietly contradict the thing it declared them for.
    expect(() =>
      parseSeedScenario(`
password: dev
users:
  - username: alice
    fullName: Alice Nguyen
    email: alice@example.com
  - username: frank
    fullName: Frank Boyle
    email: frank@example.com
    organizationMember: false
organization:
  name: mercy-health
  displayName: Mercy Health
  owner: alice
binders:
  - name: policies
    description: Policies
    members:
      - user: frank
        role: authors
    documents: []
`),
    ).toThrow(/declared outside the organization/);
  });

  test("rejects a sign-off rule naming a group the binder has not granted", () => {
    // Gitea would write the review request and then hold the merge for an
    // approval from people who cannot open the change to give one — a binder
    // that can never publish again, produced by a line that looks right.
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members: []
    signOff:
      - scope: binder
        teams:
          - quality-committee
    documents: []`).replace(
          "  owner: alice",
          `  owner: alice
  groups:
    - name: quality-committee
      level: reviewer
      description: The committee
      members:
        - bob`,
        ),
      ),
    ).toThrow(/not granted on this binder/);
  });

  test("rejects a rule over a folder the binder does not have", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members: []
    signOff:
      - scope: folder
        target: nursing
        users:
          - alice
    documents: []`),
      ),
    ).toThrow(/no folder "nursing"/);
  });

  test("rejects a rule that names the wrong number of things", () => {
    const rule = (body: string) =>
      scenarioYaml(`  - name: policies
    description: Policies
    members: []
    signOff:
${body}
    documents: []`);

    expect(() =>
      parseSeedScenario(
        rule(`      - scope: folder
        users:
          - alice`),
      ),
    ).toThrow(/has to say which folder/);

    expect(() =>
      parseSeedScenario(
        rule(`      - scope: binder
        target: nursing
        users:
          - alice`),
      ),
    ).toThrow(/takes no target/);
  });

  test("reads an act from the single key it is written under", () => {
    const scenario = parseSeedScenario(
      scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents: []
    changes:
      - branch: shape/alice/20260101000000
        title: Make a folder
        summary: X
        acts:
          - newFolder: nursing`),
    );

    expect(scenario.binders[0]?.changes[0]?.acts).toEqual([
      { kind: "newFolder", folder: "nursing" },
    ]);
  });

  test("rejects an act written under two keys, or none", () => {
    const acts = (body: string) =>
      scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents: []
    changes:
      - branch: shape/alice/20260101000000
        title: X
        summary: X
        acts:
${body}`);

    expect(() =>
      parseSeedScenario(
        acts(`          - newFolder: nursing
            archive: nursing/handbook`),
      ),
    ).toThrow(/one key naming what it does/);

    expect(() => parseSeedScenario(acts("          - {}"))).toThrow(
      /one key naming what it does/,
    );

    expect(() =>
      parseSeedScenario(acts("          - unfold: nursing")),
    ).toThrow(/unknown act/);
  });

  test("insists a change about no one document says so in its branch", () => {
    // The binder reads `upload/<slugPath>/…` to work out which document a
    // change is about. A change that moves twelve has no document to be named
    // after, and one under that prefix anyway would make the binder list a
    // policy that does not exist.
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents: []
    changes:
      - branch: upload/nursing/20260101/000000Z-alice-00000001
        title: X
        summary: X
        acts:
          - newFolder: nursing`),
      ),
    ).toThrow(/must start with "shape\/"/);
  });

  test("insists a change to the rules lives under its own prefix", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(`  - name: policies
    description: Policies
    members:
      - user: alice
        role: admins
    documents: []
    changes:
      - branch: shape/alice/20260101000000
        title: X
        summary: X
        acts:
          - signOff:
              - scope: binder
                users:
                  - alice`),
      ),
    ).toThrow(/must start with "sign-off\/"/);
  });

  test("rejects a change that is both published and closed", () => {
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          oneDocument(`        changes:
          - branch: upload/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            author: bob
            publish: true
            closed: true
            document:
              title: X
              sections:
                - paragraphs: ["One."]
            reviews:
              - by: alice
                state: approved
                body: Fine.`),
        ),
      ),
    ).toThrow(/published or closed, not both/);
  });

  test("rejects moving or archiving a document that was never published", () => {
    // A document is declared in the YAML long before anything publishes it, so
    // "the binder has one of those" and "there is a file there" are different
    // questions. Asking only the first produced a rename of a path that does
    // not exist, several binders after the line that is actually wrong.
    const act = (body: string) =>
      scenarioYaml(`  - name: policies
    description: Policies
    members: []
    documents:
      - name: handbook
        folder: nursing
        description: Handbook
    changes:
      - branch: shape/alice/20260102000000
        title: X
        summary: X
        acts:
${body}`);

    expect(() =>
      parseSeedScenario(
        act(`          - move:
              from: nursing/handbook
              to: clinical/handbook`),
      ),
    ).toThrow(/never been published, so there is no file to be moved/);

    expect(() =>
      parseSeedScenario(act("          - archive: nursing/handbook")),
    ).toThrow(/no file to be taken off the record/);
  });

  test("an open change leaves the binder's shape where it found it", () => {
    // A change that is not published has not happened. Letting an open
    // proposal move things would make the change after it look wrong — or,
    // worse, make a genuinely wrong one look right.
    const yaml = (publish: boolean) =>
      scenarioYaml(`  - name: policies
    description: Policies
    members:
      - user: bob
        role: authors
    documents:
      - name: handbook
        folder: nursing
        description: Handbook
        changes:
          - branch: upload/nursing/handbook/20260101/000000Z-alice-00000001
            title: X
            summary: X
            author: bob
            publish: true
            document:
              title: X
              sections:
                - paragraphs: ["One."]
            reviews:
              - by: alice
                state: approved
                body: Fine.
    changes:
      - branch: shape/alice/20260102000000
        title: Refile it
        summary: X
        publish: ${publish}
        acts:
          - move:
              from: nursing/handbook
              to: clinical/handbook
        reviews:
          - by: bob
            state: approved
            body: Fine.
      - branch: shape/alice/20260103000000
        title: Refile it again
        summary: X
        publish: false
        acts:
          - move:
              from: clinical/handbook
              to: policy/handbook`);

    // Published, the second move finds the document where the first put it.
    expect(() => parseSeedScenario(yaml(true))).not.toThrow();

    // Open, it does not — and saying so is the point.
    expect(() => parseSeedScenario(yaml(false))).toThrow(
      /no document filed at "clinical\/handbook"/,
    );
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

  test("rejects a branch that names a different document", () => {
    // The branch omits the folder, so the app reads it as a change about a
    // document at the binder's root: the real one loses its open-change count
    // and a policy that does not exist appears beside it. It seeds fine and
    // looks right in Gitea, which is exactly why it has to fail here.
    expect(() =>
      parseSeedScenario(
        scenarioYaml(
          `  - name: policies
    description: Policies
    members: []
    documents:
      - name: handbook
        folder: hr
        description: Handbook
${A_CHANGE}`,
        ),
      ),
    ).toThrow(/must start with "upload\/hr\/handbook\//);
  });

  test("a document at the binder's root needs no folder in its branch", () => {
    expect(() =>
      parseSeedScenario(scenarioYaml(oneDocument(A_CHANGE))),
    ).not.toThrow();
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
    expect(scenario.organization.name).toBe("riverside-health");
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
      // **Open**, not merely unpublished. A closed change is unpublished too
      // and gives the comparison nothing to show; what this file type needs is
      // a version in force and a second one being proposed against it.
      expect(
        policy?.changes.filter((change) => !change.publish && !change.closed),
      ).toHaveLength(1);
    }
  });

  test("every file format the seed can write is somewhere in the stack", () => {
    // This used to assert that *everything else* was the editor's own JSON,
    // which stopped being the point once the manual grew past one policy of
    // each kind. What is worth pinning is the coverage rather than the
    // absence: a format nothing is stored in is a preview and a comparison
    // nobody can look at without making a document by hand first.
    const formats = new Set(
      allDocuments(scenario).map((document) => document.format),
    );

    expect([...formats].sort()).toEqual([...SEED_DOCUMENT_FORMATS].sort());
  });

  // -------------------------------------------------------------------------
  // The states a developer would otherwise have to build by hand.
  //
  // Each of these is a row in this file's own header table, and the test is
  // what stops the table becoming a description of a stack that used to exist.
  // They assert the *shape* rather than a name wherever a name is not pinned
  // elsewhere, so renaming a binder does not fail a test about coverage.
  // -------------------------------------------------------------------------

  test("carries a site administrator, an owner who is not one, and an outsider", () => {
    expect(
      scenario.users
        .filter((user) => user.siteAdmin)
        .map((user) => user.username),
    ).toEqual(["alice"]);

    // The persona the seed could not make: an organization owner who does not
    // run Bindersnap. Most of the billing and people screens are written for
    // them, and signing in as the site admin is not the same test.
    expect(scenario.organization.owners.length).toBeGreaterThan(0);
    for (const owner of scenario.organization.owners) {
      expect(
        scenario.users.find((user) => user.username === owner)?.siteAdmin,
      ).toBe(false);
    }

    // Somebody who belongs nowhere. Every screen behind an organization has to
    // have an answer for them.
    expect(
      scenario.users.filter((user) => !user.organizationMember),
    ).not.toHaveLength(0);
  });

  test("carries somebody in the organization and in no binder", () => {
    const inABinder = new Set(
      scenario.binders.flatMap((binder) =>
        binder.members.map((member) => member.user),
      ),
    );

    const empty = scenario.users.filter(
      (user) => user.organizationMember && !inABinder.has(user.username),
    );
    expect(empty).not.toHaveLength(0);
  });

  test("covers every shape a binder's membership comes in", () => {
    const rolesOf = (binder: (typeof scenario.binders)[number]) =>
      new Set(binder.members.map((member) => member.role));

    const shapes = scenario.binders.map((binder) =>
      [...rolesOf(binder)].sort().join("+"),
    );

    // An admin team on its own, an admin team with authors, and all three.
    // Each is a real customer and each renders differently.
    expect(shapes).toContain("admins");
    expect(shapes).toContain("admins+authors");
    expect(shapes).toContain("admins+authors+reviewers");
  });

  test("carries a binder open to the organization and binders that are not", () => {
    // This product's "public" is the org's `staff` team granted read, not
    // Gitea's repository visibility — so both states are a binder-level fact
    // and both have to be here to be looked at.
    const open = scenario.binders.filter((binder) => binder.openToOrganization);
    expect(open).not.toHaveLength(0);
    expect(open.length).toBeLessThan(scenario.binders.length);
  });

  test("carries a binder with nothing in it", () => {
    // What every new customer sees first, and the state the seed could never
    // produce — every binder it made arrived with documents already in it.
    expect(
      scenario.binders.filter(
        (binder) =>
          binder.documents.length === 0 && binder.changes.length === 0,
      ),
    ).not.toHaveLength(0);
  });

  test("files documents at the root, in a folder, and two folders down", () => {
    const depths = new Set(
      allDocuments(scenario).map(
        (document) => binderDocumentSlugPath(document).split("/").length,
      ),
    );

    expect(depths.has(1)).toBe(true);
    expect(depths.has(2)).toBe(true);
    expect(depths.has(3)).toBe(true);
  });

  test("makes a folder with nothing in it", () => {
    // "Folders are real, empty or not." A folder somebody proposed, had
    // approved and published has to appear, or the act they went through a
    // change request for did nothing visible.
    const made = scenario.binders.flatMap((binder) =>
      binder.changes.flatMap((change) =>
        change.acts.filter((act) => act.kind === "newFolder"),
      ),
    );
    expect(made).not.toHaveLength(0);

    // And none of them is a folder a document would have created anyway.
    const implied = new Set(
      allDocuments(scenario).flatMap((document) => {
        const parts = binderDocumentSlugPath(document).split("/");
        return parts
          .slice(0, -1)
          .map((_, index) => parts.slice(0, index + 1).join("/"));
      }),
    );
    for (const act of made) {
      if (act.kind !== "newFolder") continue;
      expect(implied.has(act.folder)).toBe(false);
    }
  });

  test("carries a change that moves, renames and rewrites at once", () => {
    // A rename is a change even when not a word of the document changed, and
    // the comparison cannot show it — so the change page has to say so per
    // document, and there has to be one here that makes it say so.
    const both = scenario.binders
      .flatMap((binder) => binder.changes)
      .filter(
        (change) =>
          change.acts.some((act) => act.kind === "move") &&
          change.acts.some((act) => act.kind === "revise"),
      );
    expect(both).not.toHaveLength(0);

    // And at least one of those moves both refiles and retitles, which the
    // page words differently from either on its own.
    const moves = both.flatMap((change) =>
      change.acts.filter((act) => act.kind === "move"),
    );
    const renamedAndMoved = moves.filter((act) => {
      if (act.kind !== "move") return false;
      const cut = (path: string) => {
        const at = path.lastIndexOf("/");
        return at === -1 ? ["", path] : [path.slice(0, at), path.slice(at + 1)];
      };
      const [fromFolder, fromName] = cut(act.from);
      const [toFolder, toName] = cut(act.to);
      return fromFolder !== toFolder && fromName !== toName;
    });
    expect(renamedAndMoved).not.toHaveLength(0);
  });

  test("carries a change that renames a folder and one that archives", () => {
    const kinds = new Set(
      scenario.binders.flatMap((binder) =>
        binder.changes.flatMap((change) => change.acts.map((act) => act.kind)),
      ),
    );

    expect(kinds.has("renameFolder")).toBe(true);
    expect(kinds.has("archive")).toBe(true);
    // Who signs things off is itself a control, and changing it is a change.
    expect(kinds.has("signOff")).toBe(true);
  });

  test("carries a binder covered in sign-off rules and one with none", () => {
    const covered = scenario.binders.filter(
      (binder) => binder.signOff.length >= 3,
    );
    expect(covered).not.toHaveLength(0);

    // Every scope, because each is worded and enforced differently — and the
    // one nobody would guess is available is a rule over the rules.
    const scopes = new Set(
      covered.flatMap((binder) => binder.signOff.map((rule) => rule.scope)),
    );
    expect([...scopes].sort()).toEqual([
      "binder",
      "document",
      "folder",
      "rules",
    ]);

    expect(
      scenario.binders.filter((binder) => binder.signOff.length === 0),
    ).not.toHaveLength(0);
  });

  test("asks for more than one approval somewhere", () => {
    expect(
      scenario.binders.filter((binder) => binder.requiredApprovals > 1),
    ).not.toHaveLength(0);
  });

  test("carries a document with many versions", () => {
    const versions = allDocuments(scenario).map(
      (document) => document.changes.filter((change) => change.publish).length,
    );
    expect(Math.max(...versions)).toBeGreaterThanOrEqual(5);
  });

  test("carries a change out of date by several versions of its own document", () => {
    // Written down as an ordering: the change is declared before the versions
    // that then publish underneath it, so the seed cuts its branch from a
    // `main` those versions have not reached yet. Nothing else in the file
    // produces a change that is behind on its own document.
    const behind = allDocuments(scenario).filter((document) => {
      const open = document.changes.findIndex((change) => !change.publish);
      if (open === -1) return false;
      return (
        document.changes.slice(open + 1).filter((change) => change.publish)
          .length >= 2
      );
    });
    expect(behind).not.toHaveLength(0);
  });

  test("carries a change that ended each of the three ways one can", () => {
    // Published, declined and withdrawn are the whole of the Closed tab, and
    // the seed could only ever make the first. The other two are the same act
    // — closed without publishing — told apart by whether anybody had asked
    // for work, which is what the product reads and so what this checks.
    const changes = allDocuments(scenario).flatMap(
      (document) => document.changes,
    );

    expect(changes.filter((change) => change.publish)).not.toHaveLength(0);

    const closed = changes.filter((change) => change.closed);
    expect(
      closed.filter((change) =>
        change.reviews.some((review) => review.state === "changes_requested"),
      ),
    ).not.toHaveLength(0);
    expect(
      closed.filter(
        (change) =>
          !change.reviews.some(
            (review) => review.state === "changes_requested",
          ),
      ),
    ).not.toHaveLength(0);
  });

  test("carries a crowded change, a settled one, and an unsettled one", () => {
    const changes = [
      ...allDocuments(scenario).flatMap((document) => document.changes),
      ...scenario.binders.flatMap((binder) => binder.changes),
    ];

    // Sent round a committee: Gitea holding the change for people who have not
    // answered, which is a different fact from a review already given.
    expect(
      changes.filter((change) => change.reviewers.length >= 5),
    ).not.toHaveLength(0);

    // Somebody expected to act on it.
    expect(changes.filter((change) => change.assignee)).not.toHaveLength(0);

    const discussed = changes.filter((change) => change.threads.length >= 5);
    expect(discussed).not.toHaveLength(0);

    // The argument is over — and the argument is still going. One of these
    // stops a publish where the binder refuses one; the other does not.
    expect(
      discussed.filter((change) =>
        change.threads.every((thread) => thread.resolved),
      ),
    ).not.toHaveLength(0);
    expect(
      discussed.filter((change) =>
        change.threads.some((thread) => !thread.resolved),
      ),
    ).not.toHaveLength(0);
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
