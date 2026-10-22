import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "../gitea-client/client";
import {
  PublishConflict,
  runPublish,
  type PublishDeps,
  type PublishPlan,
} from "./publish";

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";
const GONE = "01J9A0B1C2D3E4F5G6H7J8K9M0";

const plan: PublishPlan = {
  org: "mercy-health",
  repo: "clinical",
  pullNumber: 12,
  mergeStyle: "merge",
  headSha: "head-1",
  branch: "upload/nursing/handover/1",
  documents: [
    {
      uid: UID,
      slugPath: "nursing/handover",
      path: `nursing/handover.${UID}.md`,
      title: "Handover",
      version: 4,
    },
  ],
  archived: [
    {
      uid: GONE,
      slugPath: "nursing/old",
      path: `nursing/old.${GONE}.md`,
      title: "Old",
      sequence: 1,
      lastVersion: 2,
    },
  ],
  publishedBy: "Alice Example (alice)",
  publisherLogin: "alice",
  blockOnUnresolvedThreads: false,
};

/** A small Gitea: one change, a tag list, and whether it has merged. */
function fakeGitea(state: {
  merged: boolean;
  headSha?: string;
  tags?: Map<string, string>;
}) {
  const tags = state.tags ?? new Map<string, string>();
  const written: string[] = [];
  const client = {
    GET: mock(async () => ({
      data: {
        merged: state.merged,
        state: state.merged ? "closed" : "open",
        merge_commit_sha: state.merged ? "merge-sha" : null,
        head: { sha: state.headSha ?? "head-1" },
      },
      error: undefined,
      response: new Response(null, { status: 200 }),
    })),
    POST: mock(
      async (
        _path: string,
        init: { body: { tag_name: string; target: string } },
      ) => {
        tags.set(init.body.tag_name, init.body.target);
        written.push(init.body.tag_name);
        return {
          data: { commit: { sha: init.body.target, created: "now" } },
          error: undefined,
          response: new Response(null, { status: 201 }),
        };
      },
    ),
  } as unknown as GiteaClient;

  const merge = mock(async () => {
    state.merged = true;
  });
  const deps: PublishDeps = {
    merge,
    stampedPolicy: async () => ({
      requiredApprovals: 1,
      approvedBy: ["Bob (bob)"],
      signOffEnforced: false,
    }),
    versionStamp: () => "stamp",
    archiveStamp: () => "archived",
    readTagCommits: async () => new Map(tags),
    discardDraftIfAny: async () => {},
  };
  return { client, deps, merge, written, tags };
}

test("a first run merges, then tags every document at the merge commit", async () => {
  const gitea = fakeGitea({ merged: false });
  const result = await runPublish({
    client: gitea.client,
    plan,
    deps: gitea.deps,
  });

  expect(gitea.merge).toHaveBeenCalledTimes(1);
  expect(result.mergeCommitSha).toBe("merge-sha");
  expect(gitea.written).toEqual([`${UID}/v4`, `${GONE}/archived-1`]);
  expect([...gitea.tags.values()]).toEqual(["merge-sha", "merge-sha"]);
});

test("a run resumed after the merge does not merge again, and writes only what is missing", async () => {
  // The last run merged and wrote the version tag, then died.
  const gitea = fakeGitea({
    merged: true,
    tags: new Map([[`${UID}/v4`, "merge-sha"]]),
  });
  const result = await runPublish({
    client: gitea.client,
    plan,
    deps: gitea.deps,
  });

  expect(gitea.merge).not.toHaveBeenCalled();
  expect(gitea.written).toEqual([`${GONE}/archived-1`]);
  expect(result.tags.map((tag) => tag.tag)).toEqual([`${UID}/v4`]);
});

test("a version already taken by another commit stops the run and overwrites nothing", async () => {
  const gitea = fakeGitea({
    merged: true,
    tags: new Map([[`${UID}/v4`, "somebody-elses-merge"]]),
  });

  await expect(
    runPublish({ client: gitea.client, plan, deps: gitea.deps }),
  ).rejects.toBeInstanceOf(PublishConflict);
  expect(gitea.written).toEqual([]);
});

test("a change pushed to after it was checked is not merged", async () => {
  const gitea = fakeGitea({ merged: false, headSha: "head-2" });

  await expect(
    runPublish({ client: gitea.client, plan, deps: gitea.deps }),
  ).rejects.toBeInstanceOf(PublishConflict);
  expect(gitea.merge).not.toHaveBeenCalled();
  expect(gitea.written).toEqual([]);
});
