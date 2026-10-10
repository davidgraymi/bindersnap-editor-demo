import { describe, expect, test } from "bun:test";

import type { GiteaClient } from "./client";
import {
  conflictKey,
  findConflictingFiles,
  resolveChangeConflicts,
  type ConflictingFile,
} from "./conflicts";

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const HANDS = `nursing/hand-hygiene.${UID}.json`;

const tree = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));

describe("which files conflict", () => {
  test("a file changed on one side only is git's to merge", () => {
    const base = tree({ [HANDS]: "b", "a.md": "1" });
    expect(
      findConflictingFiles(base, tree({ [HANDS]: "o", "a.md": "1" }), base),
    ).toEqual([]);
    expect(
      findConflictingFiles(base, base, tree({ [HANDS]: "t", "a.md": "1" })),
    ).toEqual([]);
  });

  test("the same change on both sides is not a conflict", () => {
    const base = tree({ [HANDS]: "b" });
    const both = tree({ [HANDS]: "x" });
    expect(findConflictingFiles(base, both, both)).toEqual([]);
  });

  test("two different edits of one document need a person", () => {
    const [conflict] = findConflictingFiles(
      tree({ [HANDS]: "b" }),
      tree({ [HANDS]: "o" }),
      tree({ [HANDS]: "t" }),
    );
    expect(conflict).toMatchObject({
      key: `uid:${UID}`,
      path: HANDS,
      automatic: null,
      ours: { path: HANDS, sha: "o" },
      theirs: { path: HANDS, sha: "t" },
    });
  });

  test("a document moved on one side and edited on the other is paired by identity, and settles itself", () => {
    const moved = `clinical/hand-hygiene.${UID}.json`;
    const conflicts = findConflictingFiles(
      tree({ [HANDS]: "b" }),
      tree({ [HANDS]: "o" }),
      tree({ [moved]: "b" }),
    );
    expect(conflicts).toHaveLength(1);
    // The edit, at the new address.
    expect(conflicts[0]).toMatchObject({ path: moved, automatic: "ours" });

    const [other] = findConflictingFiles(
      tree({ [HANDS]: "b" }),
      tree({ [moved]: "b" }),
      tree({ [HANDS]: "t" }),
    );
    expect(other).toMatchObject({ path: moved, automatic: "theirs" });
  });

  test("an edit against a removal needs a person, and keeps the address that still exists", () => {
    const [removedHere] = findConflictingFiles(
      tree({ [HANDS]: "b" }),
      tree({}),
      tree({ [HANDS]: "t" }),
    );
    expect(removedHere).toMatchObject({
      ours: null,
      path: HANDS,
      automatic: null,
    });

    const [removedThere] = findConflictingFiles(
      tree({ [HANDS]: "b" }),
      tree({ [HANDS]: "o" }),
      tree({}),
    );
    expect(removedThere).toMatchObject({ theirs: null, automatic: null });
  });

  test("a file with no identity is keyed by its path", () => {
    expect(conflictKey(".gitea/CODEOWNERS")).toBe("path:.gitea/CODEOWNERS");
    expect(conflictKey(HANDS)).toBe(`uid:${UID}`);
    const [codeowners] = findConflictingFiles(
      tree({ ".gitea/CODEOWNERS": "b" }),
      tree({ ".gitea/CODEOWNERS": "o" }),
      tree({ ".gitea/CODEOWNERS": "t" }),
    );
    expect(codeowners?.key).toBe("path:.gitea/CODEOWNERS");
  });
});

/** A Gitea that records what was written and can be told to refuse a merge. */
function fakeGitea(options: { mergeFails?: boolean } = {}) {
  const commits: Array<{ message: string; files: unknown[] }> = [];
  const blobs: Record<string, string> = { o: "T1VSUw==", t: "VEhFSVJT" };
  let merged = false;

  const client = {
    GET: async (path: string, init: { params: { path: { sha?: string } } }) => {
      if (path.endsWith("/git/blobs/{sha}")) {
        const sha = init.params.path.sha!;
        return {
          data: { content: blobs[sha], size: 5 },
          response: new Response(null, { status: 200 }),
        };
      }
      // The pull request, polled after the update: up to date once merged.
      return {
        data: {
          merge_base: merged ? "main2" : "main1",
          base: { sha: "main2" },
        },
        response: new Response(null, { status: 200 }),
      };
    },
    POST: async (
      path: string,
      init: { body?: { message: string; files: unknown[] } },
    ) => {
      if (path.endsWith("/contents")) {
        commits.push({ message: init.body!.message, files: init.body!.files });
        return { data: {}, response: new Response(null, { status: 201 }) };
      }
      if (options.mergeFails) {
        return {
          error: { message: "merge conflict" },
          response: new Response(null, { status: 409 }),
        };
      }
      merged = true;
      commits.push({ message: "(merge main)", files: [] });
      return { data: undefined, response: new Response(null, { status: 200 }) };
    },
  } as unknown as GiteaClient;

  return { client, commits };
}

const conflict: ConflictingFile = {
  key: `uid:${UID}`,
  base: { path: HANDS, sha: "b" },
  ours: { path: HANDS, sha: "o" },
  theirs: { path: HANDS, sha: "t" },
  path: HANDS,
  automatic: null,
};

const params = {
  org: "riverside",
  workspace: "clinical",
  pullNumber: 7,
  branch: "draft/alice/1",
  conflicts: [conflict],
  username: "alice",
};

describe("resolving", () => {
  test("takes the published version, merges, then writes the decision", async () => {
    const { client, commits } = fakeGitea();
    const result = await resolveChangeConflicts({
      ...params,
      client,
      resolutions: [
        { key: conflict.key, take: "content", base64Content: "Qk9USA==" },
      ],
    });

    expect(result.caughtUp).toBe(true);
    expect(commits.map((commit) => commit.message.split("\n")[0])).toEqual([
      "Take the published version of 1 document before bringing the change up to date",
      "(merge main)",
      "Resolve conflicts with the published binder",
    ]);
    expect(commits[0]!.files).toEqual([
      { operation: "upload", path: HANDS, content: "VEhFSVJT" },
    ]);
    expect(commits[2]!.files).toEqual([
      { operation: "upload", path: HANDS, content: "Qk9USA==" },
    ]);
    expect(commits[2]!.message).toContain("combined both versions");
    expect(commits[2]!.message).toContain("Resolved by: alice");
  });

  test("choosing the published version writes nothing after the merge", async () => {
    const { client, commits } = fakeGitea();
    await resolveChangeConflicts({
      ...params,
      client,
      resolutions: [{ key: conflict.key, take: "theirs" }],
    });
    expect(commits).toHaveLength(2);
  });

  test("an undecided file is refused before anything is written", async () => {
    const { client, commits } = fakeGitea();
    await expect(
      resolveChangeConflicts({ ...params, client, resolutions: [] }),
    ).rejects.toThrow(/Decide what happens/);
    expect(commits).toHaveLength(0);
  });

  test("a merge that still fails puts the change's own version back", async () => {
    const { client, commits } = fakeGitea({ mergeFails: true });
    await expect(
      resolveChangeConflicts({
        ...params,
        client,
        resolutions: [{ key: conflict.key, take: "ours" }],
      }),
    ).rejects.toThrow();
    expect(commits.map((commit) => commit.message)).toEqual([
      "Take the published version of 1 document before bringing the change up to date",
      "Restore the change's own version of 1 document",
    ]);
    expect(commits[1]!.files).toEqual([
      { operation: "upload", path: HANDS, content: "T1VSUw==" },
    ]);
  });
});
