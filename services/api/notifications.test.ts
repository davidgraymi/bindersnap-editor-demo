import { describe, expect, test } from "bun:test";

import {
  readSubjectUrl,
  reasonFor,
  toAppNotifications,
  pullKey,
} from "./notifications";
import type { components } from "./gitea-client/spec/gitea";

type PullRequest = components["schemas"]["PullRequest"];

const url = "http://gitea:3000/api/v1/repos/riverside-health/clinical/pulls/7";

describe("readSubjectUrl", () => {
  test("reads the change a thread is about", () => {
    expect(readSubjectUrl(url)).toEqual({
      org: "riverside-health",
      binder: "clinical",
      number: 7,
    });
    expect(readSubjectUrl("http://x/api/v1/repos/a/b/commits/abc")).toBeNull();
  });
});

describe("reasonFor", () => {
  const pull = (extra: object) =>
    ({ user: { login: "carol" }, state: "open", ...extra }) as PullRequest;

  test("a change waiting on you says so, and who asked", () => {
    expect(
      reasonFor(
        pull({ requested_reviewers: [{ login: "bob" }] }),
        "open",
        "bob",
      ),
    ).toEqual({
      reason: "review_requested",
      actor: "carol",
      actorName: "carol",
    });
  });

  test("a published change names who published it", () => {
    expect(
      reasonFor(
        pull({ merged: true, merged_by: { login: "alice" } }),
        "merged",
        "bob",
      ),
    ).toEqual({
      reason: "published",
      actor: "alice",
      actorName: "alice",
    });
  });

  test("activity on your own change, and on somebody else's", () => {
    expect(reasonFor(pull({}), "open", "carol").reason).toBe("your_change");
    expect(reasonFor(pull({}), "open", "bob").reason).toBe("activity");
    expect(reasonFor(null, "closed", "bob").reason).toBe("closed");
  });
});

describe("toAppNotifications", () => {
  test("keeps change requests only, titled from the change", () => {
    const pulls = new Map<string, PullRequest>([
      [
        pullKey("riverside-health", "clinical", 7),
        { title: "Gloves", user: { login: "carol" }, state: "open" },
      ],
    ]);
    const notes = toAppNotifications(
      [
        {
          id: 1,
          unread: true,
          updated_at: "2026-09-29T10:00:00Z",
          subject: { type: "Pull", url, title: "old", state: "open" },
        },
        {
          id: 2,
          unread: true,
          subject: { type: "Issue", url: url.replace("pulls", "issues") },
        },
      ],
      pulls,
      "bob",
    );
    expect(notes).toEqual([
      {
        id: 1,
        unread: true,
        org: "riverside-health",
        binder: "clinical",
        changeNumber: 7,
        title: "Gloves",
        reason: "activity",
        actor: "carol",
        actorName: "carol",
        updatedAt: "2026-09-29T10:00:00Z",
      },
    ]);
  });
});
