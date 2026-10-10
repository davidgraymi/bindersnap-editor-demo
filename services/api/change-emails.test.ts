import { expect, test } from "bun:test";

import {
  changeEmail,
  changeEmailKey,
  changeUrl,
  recipientsFor,
} from "./change-emails";

const facts = {
  owner: "mercy-health",
  repo: "clinical",
  number: 12,
  title: "Hand hygiene: add the alcohol rub step",
  author: "jkim",
  actor: "bob",
  actorName: "Bob Ortiz",
};

test("a review request goes to the reviewers, never to whoever asked", () => {
  expect(
    recipientsFor(
      { kind: "review-requested", reviewers: ["carol", "Bob", "dan", "carol"] },
      facts,
    ),
  ).toEqual(["carol", "dan"]);
});

test("asked-for changes and readiness go to the author", () => {
  expect(
    recipientsFor({ kind: "changes-requested", comment: "x" }, facts),
  ).toEqual(["jkim"]);
  expect(recipientsFor({ kind: "ready-to-publish" }, facts)).toEqual(["jkim"]);
  // An author approving their own (where a binder allows it) is not emailed.
  expect(
    recipientsFor(
      { kind: "ready-to-publish" },
      { author: "jkim", actor: "JKim" },
    ),
  ).toEqual([]);
});

test("a publish goes to the author and every participant, once each", () => {
  expect(
    recipientsFor(
      { kind: "published", participants: ["carol", "bob", "jkim", "dan"] },
      { author: "jkim", actor: "bob" },
    ),
  ).toEqual(["jkim", "carol", "dan"]);
});

test("the link opens the change in the app", () => {
  expect(changeUrl("https://bindersnap.com/", facts)).toBe(
    "https://bindersnap.com/mercy-health/clinical/-/changes/12",
  );
});

test("the words are Bindersnap's: changes, reviews, publishing", () => {
  const link = changeUrl("https://bindersnap.com", facts);
  const review = changeEmail(
    { kind: "review-requested", reviewers: ["carol"] },
    facts,
    link,
  );
  expect(review.subject).toBe(`Review requested: ${facts.title}`);
  expect(review.heading).toBe("Bob Ortiz asked you to review a change");
  expect(review.action).toEqual({ label: "Review the change", url: link });

  const asked = changeEmail(
    { kind: "changes-requested", comment: "Cite the WHO guideline." },
    facts,
    link,
  );
  expect(asked.paragraphs.at(-1)).toBe("“Cite the WHO guideline.”");

  for (const kind of ["ready-to-publish", "published"] as const) {
    const email = changeEmail(
      kind === "published" ? { kind, participants: [] } : { kind },
      facts,
      link,
    );
    expect(JSON.stringify(email).toLowerCase()).not.toContain("pull request");
  }
});

test("a long comment is cut, not the email", () => {
  const email = changeEmail(
    { kind: "changes-requested", comment: "a".repeat(2000) },
    facts,
    "https://x",
  );
  expect(email.paragraphs.at(-1)!.length).toBeLessThan(700);
  expect(email.paragraphs.at(-1)).toEndWith("…”");
});

test("one email per person per occurrence", () => {
  const event = { kind: "ready-to-publish" } as const;
  expect(changeEmailKey(event, facts, "JKim", "abc123")).toBe(
    "change:ready-to-publish:mercy-health/clinical#12:jkim:abc123",
  );
});
