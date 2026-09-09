import { expect, test } from "bun:test";

import { scopeChangeBase, scopeKey, scopeRepo } from "./changeScope";

/**
 * This used to assert that *both* shapes worked — a document repository and a
 * binder — because ADR 0004 ran the two models side by side. The old model is
 * deleted, so the union has collapsed to the one that remains and these are
 * the same assertions with the other half gone.
 */

const binder = {
  org: "riverside-health",
  binder: "clinical",
  documentPath: "nursing/hand-hygiene",
} as const;

test("a scope names the repository the change lives in", () => {
  expect(scopeRepo(binder)).toEqual({
    owner: "riverside-health",
    repo: "clinical",
  });
});

test("the paywall path names the route that was actually called", () => {
  // It decides whether a 402 gets the banner or a raw error, so a path that
  // did not match the request would leave a delinquent organization confused.
  expect(scopeChangeBase(binder, 3)).toBe(
    "/api/app/binders/riverside-health/clinical/changes/3",
  );
});

test("the key changes when the document inside the binder does", () => {
  // One binder holds many documents and a change is about one of them, so an
  // effect keyed on the binder alone would not reload between two documents.
  expect(scopeKey(binder)).not.toBe(
    scopeKey({ ...binder, documentPath: "nursing/isolation" }),
  );
  expect(scopeKey(binder)).toContain("nursing/hand-hygiene");
});

test("the key separates two binders that share a name", () => {
  // Two organizations may each have a binder called `clinical`, and a person
  // can belong to both.
  expect(scopeKey(binder)).not.toBe(scopeKey({ ...binder, org: "mercy" }));
});

test("a change about no document still has a key", () => {
  // A sign-off rules change touches no document, so `documentPath` is empty
  // and the key is the binder's alone. It still has to be stable.
  const rules = { ...binder, documentPath: "" };
  expect(scopeKey(rules)).toBe(scopeKey({ ...rules }));
  expect(scopeKey(rules)).not.toBe(scopeKey(binder));
});
