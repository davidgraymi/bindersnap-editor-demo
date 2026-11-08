import { expect, test } from "bun:test";

import type { GiteaClient } from "./gitea-client/client";
import type { BinderDraft } from "./gitea-client/drafts";
import type { WorkspaceSummary } from "./gitea-client/workspaces";
import { readMyDrafts, type MyDraftsDeps } from "./my-drafts";

const client = {} as GiteaClient;

function binder(id: number, name: string, push = true): WorkspaceSummary {
  return {
    id,
    name,
    fullName: name,
    owner: "riverside",
    description: "",
    openChangeCount: 0,
    updatedAt: "",
    access: { push, admin: false },
  };
}

function draft(
  branch: string,
  updatedAt: string,
  changeNumber: number | null = null,
): BinderDraft {
  return { branch, owner: "alice", updatedAt, lastAct: "Edit", changeNumber };
}

function deps(over: Partial<MyDraftsDeps> = {}): MyDraftsDeps & {
  asked: Array<{
    org: string;
    workspace: string;
    owner?: string;
    proposed?: boolean;
  }>;
} {
  const asked: Array<{
    org: string;
    workspace: string;
    owner?: string;
    proposed?: boolean;
  }> = [];
  return {
    asked,
    listOrganizations: async () => ["riverside", "lakeside"],
    listBinders: async (_client, org) =>
      org === "riverside"
        ? [binder(1, "clinical"), binder(2, "hr"), binder(3, "board", false)]
        : [binder(4, "policies")],
    listDrafts: async (params) => {
      asked.push(params);
      if (params.workspace === "clinical") {
        return [draft("draft/alice/1", "2026-11-01T10:00:00Z")];
      }
      if (params.workspace === "policies") {
        return [draft("draft/alice/2", "2026-11-05T10:00:00Z", 7)];
      }
      return [];
    },
    readActs: async ({ branch }) =>
      branch === "draft/alice/1"
        ? [
            {
              summary: "Edit a",
              sha: "1",
              at: null,
              paths: ["a.01J8XZ4K7M0000000000000000.json"],
            },
            {
              summary: "Edit b",
              sha: "2",
              at: null,
              paths: ["b.01J8XZ4K7M0000000000000001.json"],
            },
          ]
        : [],
    names: {
      forBranches: async (_id, branches) =>
        new Map(
          branches
            .filter((branch) => branch === "draft/alice/1")
            .map((branch) => [
              branch,
              { name: "Spring revisions", authored: true },
            ]),
        ),
    },
    ...over,
  } as MyDraftsDeps & { asked: typeof asked };
}

test("lists the reader's own drafts in every organization, newest first", async () => {
  const d = deps();
  const drafts = await readMyDrafts({ client, username: "alice", deps: d });

  expect(
    drafts.map((row) => [row.organization, row.workspace, row.branch]),
  ).toEqual([
    ["lakeside", "policies", "draft/alice/2"],
    ["riverside", "clinical", "draft/alice/1"],
  ]);
  expect(drafts[0]?.changeNumber).toBe(7);
  expect(drafts[1]?.name).toBe("Spring revisions");
  expect(drafts[1]?.actCount).toBe(2);
  // Only their own, with the proposed ones too.
  expect(d.asked.every((ask) => ask.owner === "alice" && ask.proposed)).toBe(
    true,
  );
});

test("skips binders the reader cannot write in", async () => {
  const d = deps();
  await readMyDrafts({ client, username: "alice", deps: d });
  expect(d.asked.map((ask) => ask.workspace)).not.toContain("board");
});

test("narrows to one organization, and to one binder in it", async () => {
  const org = deps();
  const inOrg = await readMyDrafts({
    client,
    username: "alice",
    org: "riverside",
    deps: org,
  });
  expect(inOrg.map((row) => row.workspace)).toEqual(["clinical"]);
  expect(org.asked.map((ask) => ask.org)).toEqual(["riverside", "riverside"]);

  const one = deps();
  await readMyDrafts({
    client,
    username: "alice",
    org: "riverside",
    binder: "hr",
    deps: one,
  });
  expect(one.asked.map((ask) => ask.workspace)).toEqual(["hr"]);
});

test("a binder that cannot be read is left out rather than failing the list", async () => {
  const d = deps({
    listDrafts: async (params) => {
      if (params.workspace === "clinical")
        throw new Error("Gitea answered 500");
      return params.workspace === "policies"
        ? [draft("draft/alice/2", "2026-11-05T10:00:00Z")]
        : [];
    },
  });
  const drafts = await readMyDrafts({ client, username: "alice", deps: d });
  expect(drafts.map((row) => row.workspace)).toEqual(["policies"]);
});

test("an unnamed draft is called by its date", async () => {
  const drafts = await readMyDrafts({
    client,
    username: "alice",
    deps: deps(),
  });
  expect(drafts[0]?.name).toMatch(/Draft of/);
});
