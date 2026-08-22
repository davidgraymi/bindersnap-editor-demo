import { describe, expect, it } from "bun:test";

import type { WorkspaceDocumentSummary } from "./api";
import {
  applyPersonFilter,
  buildDocumentRow,
  buildDocumentRows,
  buildDocumentsUrl,
  collectOwners,
  describeDocumentCount,
  parseDocumentsViewState,
  resolveDocumentRowStatus,
  toSearchParams,
} from "./documentsView";

const NOW = new Date("2026-08-22T12:00:00Z").getTime();

function reviewer(
  login: string,
  status: "awaiting" | "approved" | "changes_requested" | "commented",
  stale = false,
) {
  return {
    login,
    fullName: "",
    avatarUrl: "",
    status,
    reviewedAt: "",
    stale,
    requested: true,
  };
}

function change(
  overrides: Partial<WorkspaceDocumentSummary["pendingPRs"][number]> = {},
): WorkspaceDocumentSummary["pendingPRs"][number] {
  return {
    id: 1,
    number: 1,
    title: "",
    state: "open",
    created: "2026-08-22T10:00:00Z",
    created_at: "2026-08-22T10:00:00Z",
    updated_at: "2026-08-22T10:00:00Z",
    branchName: "upload/v2",
    approvalCount: 0,
    requiredApprovals: 1,
    isApproved: false,
    isRejected: false,
    reviewers: [],
    assignee: null,
    approvalState: "in_review",
    user: { login: "maya" },
    ...overrides,
  };
}

function doc(
  overrides: {
    name?: string;
    owner?: string;
    updatedAt?: string;
    version?: number | null;
    tagCreated?: string;
    pendingPRs?: WorkspaceDocumentSummary["pendingPRs"];
  } = {},
): WorkspaceDocumentSummary {
  const version = overrides.version === undefined ? 3 : overrides.version;
  return {
    repo: {
      id: 1,
      name: overrides.name ?? "vendor-agreement",
      full_name: `${overrides.owner ?? "jack"}/${overrides.name ?? "vendor-agreement"}`,
      description: "",
      updated_at: overrides.updatedAt ?? "2026-08-22T10:00:00Z",
      owner: { login: overrides.owner ?? "jack" },
    },
    latestTag:
      version === null
        ? null
        : {
            name: `v${version}`,
            version,
            sha: "abc",
            created: overrides.tagCreated ?? "2026-08-19T09:00:00Z",
          },
    pendingPRs: overrides.pendingPRs ?? [],
    error: null,
  };
}

describe("parseDocumentsViewState", () => {
  it("defaults to the documents the reader contributes to", () => {
    expect(parseDocumentsViewState("", "dana")).toEqual({
      view: "contributing",
      people: [],
      freeText: "",
    });
  });

  it("reads a saved view and person chips out of the URL", () => {
    expect(
      parseDocumentsViewState("?view=owned&person=jack,priya", "dana"),
    ).toEqual({ view: "owned", people: ["jack", "priya"], freeText: "" });
  });

  it("ignores a view it does not recognise", () => {
    expect(parseDocumentsViewState("?view=nonsense", "dana").view).toBe(
      "contributing",
    );
  });

  it("maps the owner:@me power query onto the 'I own' chip", () => {
    const state = parseDocumentsViewState("?q=owner:@me", "dana");
    expect(state.view).toBe("owned");
    expect(state.people).toEqual([]);
  });

  it("maps contributed-by:@me onto the default chip", () => {
    expect(
      parseDocumentsViewState("?q=contributed-by:@dana", "dana").view,
    ).toBe("contributing");
  });

  it("turns owner:@someone-else into a person chip over everything", () => {
    const state = parseDocumentsViewState("?q=owner:@jack", "dana");
    expect(state).toEqual({
      view: "everything",
      people: ["jack"],
      freeText: "",
    });
  });

  it("keeps the plain words alongside a filter", () => {
    expect(
      parseDocumentsViewState("?q=owner:@me retention", "dana").freeText,
    ).toBe("retention");
  });

  it("does not repeat a person named twice", () => {
    expect(
      parseDocumentsViewState("?q=owner:@jack&person=Jack", "dana").people,
    ).toEqual(["jack"]);
  });
});

describe("buildDocumentsUrl", () => {
  it("gives the default view the plainest URL", () => {
    expect(
      buildDocumentsUrl({ view: "contributing", people: [], freeText: "" }),
    ).toBe("/documents");
  });

  it("carries view, people and search", () => {
    expect(
      buildDocumentsUrl({
        view: "everything",
        people: ["jack", "priya"],
        freeText: "retention policy",
      }),
    ).toBe("/documents?view=everything&person=jack%2Cpriya&q=retention+policy");
  });

  it("round-trips through the parser", () => {
    const state = {
      view: "owned" as const,
      people: ["jack"],
      freeText: "nda",
    };
    const url = buildDocumentsUrl(state);
    expect(parseDocumentsViewState(url.split("?")[1] ?? "", "dana")).toEqual(
      state,
    );
  });
});

describe("toSearchParams", () => {
  it("asks for the reader's own documents", () => {
    expect(
      toSearchParams({ view: "owned", people: [], freeText: "" }, "dana"),
    ).toEqual({ ownerUsername: "dana", freeText: undefined });
  });

  it("asks for membership on the default view", () => {
    expect(
      toSearchParams(
        { view: "contributing", people: [], freeText: "" },
        "dana",
      ),
    ).toEqual({ memberUsername: "dana", freeText: undefined });
  });

  it("asks for nothing at all when the scope is everything", () => {
    expect(
      toSearchParams({ view: "everything", people: [], freeText: "" }, "dana"),
    ).toBeUndefined();
  });

  it("sends plain words on any scope", () => {
    expect(
      toSearchParams({ view: "everything", people: [], freeText: "nda" }, "d"),
    ).toEqual({ freeText: "nda" });
  });

  it("leaves the person filter to the client", () => {
    expect(
      toSearchParams({ view: "owned", people: ["jack"], freeText: "" }, "dana"),
    ).toEqual({ ownerUsername: "dana", freeText: undefined });
  });
});

describe("applyPersonFilter", () => {
  const documents = [
    doc({ owner: "jack" }),
    doc({ owner: "priya", name: "employee-handbook" }),
    doc({ owner: "dana", name: "mutual-nda" }),
  ];

  it("passes everything through when nobody is named", () => {
    expect(applyPersonFilter(documents, [])).toHaveLength(3);
  });

  it("keeps only the named owners, case-insensitively", () => {
    const filtered = applyPersonFilter(documents, ["Jack", "priya"]);
    expect(filtered.map((d) => d.repo.owner.login)).toEqual(["jack", "priya"]);
  });
});

describe("collectOwners", () => {
  it("lists each owner once, in order", () => {
    expect(
      collectOwners([
        doc({ owner: "priya" }),
        doc({ owner: "jack", name: "a" }),
        doc({ owner: "priya", name: "b" }),
      ]),
    ).toEqual(["jack", "priya"]);
  });
});

describe("resolveDocumentRowStatus", () => {
  it("calls a document with nothing open and a version Current", () => {
    expect(resolveDocumentRowStatus(doc(), "dana")).toBe("current");
  });

  it("calls a document with no version at all a Draft", () => {
    expect(resolveDocumentRowStatus(doc({ version: null }), "dana")).toBe(
      "draft",
    );
  });

  it("says a review is owed when the reader is still awaited", () => {
    const document = doc({
      pendingPRs: [change({ reviewers: [reviewer("dana", "awaiting")] })],
    });
    expect(resolveDocumentRowStatus(document, "dana")).toBe(
      "needs_your_review",
    );
  });

  it("counts a stale approval as a review still owed", () => {
    const document = doc({
      pendingPRs: [change({ reviewers: [reviewer("dana", "approved", true)] })],
    });
    expect(resolveDocumentRowStatus(document, "dana")).toBe(
      "needs_your_review",
    );
  });

  it("never asks the reader to review their own submission", () => {
    const document = doc({
      pendingPRs: [
        change({
          user: { login: "dana" },
          reviewers: [reviewer("dana", "awaiting")],
        }),
      ],
    });
    expect(resolveDocumentRowStatus(document, "dana")).toBe("in_review");
  });

  it("reports a fully approved change as ready to publish", () => {
    const document = doc({
      pendingPRs: [change({ approvalCount: 1, requiredApprovals: 1 })],
    });
    expect(resolveDocumentRowStatus(document, "dana")).toBe("ready_to_publish");
  });

  it("does not call a rejected change ready", () => {
    const document = doc({
      pendingPRs: [
        change({ approvalCount: 1, requiredApprovals: 1, isRejected: true }),
      ],
    });
    expect(resolveDocumentRowStatus(document, "dana")).toBe("in_review");
  });

  it("puts the reader's own review ahead of a change that is ready", () => {
    const document = doc({
      pendingPRs: [
        change({ number: 1, approvalCount: 1, requiredApprovals: 1 }),
        change({ number: 2, reviewers: [reviewer("dana", "awaiting")] }),
      ],
    });
    expect(resolveDocumentRowStatus(document, "dana")).toBe(
      "needs_your_review",
    );
  });
});

describe("buildDocumentRow", () => {
  it("writes the meta line the mockup shows for someone else's document", () => {
    const document = doc({
      owner: "jack",
      updatedAt: "2026-08-22T10:00:00Z",
      pendingPRs: [
        change({ number: 1, reviewers: [reviewer("dana", "awaiting")] }),
        change({ number: 2 }),
      ],
    });

    const row = buildDocumentRow(document, "dana", NOW);
    expect(row.name).toBe("Vendor Agreement");
    expect(row.meta).toBe("Jack owns · v3 · 2 open changes · updated 2h ago");
    expect(row.statusLabel).toBe("Needs your review");
    expect(row.urgent).toBe(true);
  });

  it("names the reader's own proposal rather than counting it", () => {
    const document = doc({
      owner: "dana",
      name: "q3-compliance-policy",
      updatedAt: "2026-08-21T09:00:00Z",
      pendingPRs: [change({ user: { login: "dana" } })],
    });

    expect(buildDocumentRow(document, "dana", NOW).meta).toBe(
      "You own · v3 · your v4 proposal in review · updated yesterday",
    );
  });

  it("says when a single change is ready to publish", () => {
    const document = doc({
      owner: "dana",
      name: "data-retention-policy",
      version: 1,
      updatedAt: "2026-08-22T09:00:00Z",
      pendingPRs: [
        change({
          user: { login: "dana" },
          approvalCount: 2,
          requiredApprovals: 2,
        }),
      ],
    });

    const row = buildDocumentRow(document, "dana", NOW);
    expect(row.meta).toBe(
      "You own · v1 · 1 open change, ready to publish · updated 3h ago",
    );
    expect(row.statusLabel).toBe("Ready to publish");
  });

  it("dates a settled document by its approval, not its last touch", () => {
    const document = doc({
      owner: "priya",
      name: "employee-handbook",
      version: 6,
      tagCreated: "2026-08-19T09:00:00Z",
    });

    const row = buildDocumentRow(document, "dana", NOW);
    expect(row.meta).toBe(
      "Priya owns · v6 · no open changes · approved Aug 19",
    );
    expect(row.statusLabel).toBe("Current");
    expect(row.urgent).toBe(false);
  });

  it("admits when nothing has been published yet", () => {
    const document = doc({ owner: "dana", version: null });
    expect(buildDocumentRow(document, "dana", NOW).meta).toContain(
      "You own · no version published yet · no open changes",
    );
  });
});

describe("buildDocumentRows", () => {
  it("puts the most recently moved document first", () => {
    const rows = buildDocumentRows(
      [
        doc({ name: "old-one", updatedAt: "2026-08-01T09:00:00Z" }),
        doc({ name: "new-one", updatedAt: "2026-08-22T09:00:00Z" }),
      ],
      "dana",
      NOW,
    );
    expect(rows.map((row) => row.repo)).toEqual(["new-one", "old-one"]);
  });
});

describe("describeDocumentCount", () => {
  it("names the scope", () => {
    expect(describeDocumentCount("contributing", 6, 6)).toBe(
      "6 documents you contribute to",
    );
    expect(describeDocumentCount("owned", 1, 1)).toBe("1 document you own");
  });

  it("says how much was filtered away", () => {
    expect(describeDocumentCount("everything", 2, 6)).toBe(
      "2 of 6 documents you can see",
    );
  });
});
