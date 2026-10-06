import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./gitea-client/client";
import { findUnversionedMerges, reconcileBinders } from "./reconciler";

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";

test("a merged change with no version on its merge commit is a gap", () => {
  const gaps = findUnversionedMerges({
    org: "mercy-health",
    binder: "clinical",
    closed: [
      // Published properly: its tag is on the merge.
      {
        number: 1,
        merged: true,
        merge_commit_sha: "a",
        head: { ref: "upload/x/1" },
      },
      // Merged, never tagged.
      {
        number: 2,
        merged: true,
        merge_commit_sha: "b",
        head: { ref: "upload/y/2" },
      },
      // Closed without merging: nothing to version.
      {
        number: 3,
        merged: false,
        merge_commit_sha: null,
        head: { ref: "upload/z/3" },
      },
      // Sign-off and shape changes write no version by design.
      {
        number: 4,
        merged: true,
        merge_commit_sha: "d",
        head: { ref: "sign-off/rules" },
      },
      {
        number: 5,
        merged: true,
        merge_commit_sha: "e",
        head: { ref: "shape/folders" },
      },
    ],
    tagCommits: new Set(["a"]),
  });

  expect(gaps.map((gap) => gap.changeNumber)).toEqual([2]);
});

test("a pass reports an unprotected main and a merge with no versions, and repairs nothing", async () => {
  const writes: string[] = [];
  const client = {
    GET: mock(async (path: string) => {
      const data: Record<string, unknown> = {
        "/orgs/{org}/repos": [
          { id: 1, name: "clinical", owner: { login: "mercy-health" } },
        ],
        "/repos/{owner}/{repo}/branch_protections": [],
        "/repos/{owner}/{repo}/tags": [
          { name: `${UID}/v1`, commit: { sha: "merge-1" } },
        ],
        "/repos/{owner}/{repo}/pulls": [
          {
            number: 1,
            merged: true,
            merge_commit_sha: "merge-1",
            head: { ref: "upload/a/1" },
          },
          {
            number: 2,
            merged: true,
            merge_commit_sha: "merge-2",
            head: { ref: "draft/alice/2" },
          },
          {
            number: 3,
            merged: true,
            merge_commit_sha: "merge-3",
            head: { ref: "draft/alice/3" },
          },
        ],
      };
      return {
        data: data[path] ?? [],
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }),
    POST: mock(async (path: string) => {
      writes.push(path);
      return { data: {}, error: undefined, response: new Response() };
    }),
  } as unknown as GiteaClient;

  const report = await reconcileBinders({
    client,
    organizations: ["mercy-health"],
    // Change 3 was a draft that only made a folder: nothing to version.
    touchedDocuments: async ({ changeNumber }) => changeNumber !== 3,
    now: new Date("2026-10-02T00:00:00Z"),
  });

  expect(report.binders).toBe(1);
  expect(report.findings).toEqual([
    { kind: "unprotected-main", org: "mercy-health", binder: "clinical" },
    {
      kind: "merged-without-versions",
      org: "mercy-health",
      binder: "clinical",
      changeNumber: 2,
      mergeCommitSha: "merge-2",
      branch: "draft/alice/2",
    },
  ]);
  expect(report.errors).toEqual([]);
  expect(writes).toEqual([]);
});
