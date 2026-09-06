import { expect, test } from "bun:test";

import { scopeChangeBase, scopeKey, scopeRepo } from "./changeScope";

const document = {
  kind: "document",
  owner: "alice",
  repo: "contract",
} as const;
const binder = {
  kind: "binder",
  org: "riverside-health",
  binder: "clinical",
  documentPath: "nursing/hand-hygiene",
} as const;

test("both shapes name a repository, because both are one", () => {
  expect(scopeRepo(document)).toEqual({ owner: "alice", repo: "contract" });
  expect(scopeRepo(binder)).toEqual({
    owner: "riverside-health",
    repo: "clinical",
  });
});

test("the paywall path names the route that was actually called", () => {
  // It decides whether a 402 gets the banner or a raw error, so naming the
  // other model's route would leave a delinquent organization confused.
  expect(scopeChangeBase(document, 3)).toBe(
    "/api/app/documents/alice/contract/pull-requests/3",
  );
  expect(scopeChangeBase(binder, 3)).toBe(
    "/api/app/binders/riverside-health/clinical/changes/3",
  );
});

test("the key separates two scopes that name the same repository", () => {
  // A binder and a document repository could in principle share a name, and
  // an effect keyed on the pair alone would not reload between them.
  expect(scopeKey(document)).not.toBe(scopeKey(binder));
  expect(scopeKey(binder)).toContain("nursing/hand-hygiene");
});

test("the key changes when the document inside the binder does", () => {
  expect(scopeKey(binder)).not.toBe(
    scopeKey({ ...binder, documentPath: "nursing/handover" }),
  );
});
