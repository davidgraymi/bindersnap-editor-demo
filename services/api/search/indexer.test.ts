import { afterEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import type { GiteaClient } from "../gitea-client/client";
import { sweepSearchIndex } from "./indexer";
import { SearchStore } from "./store";

const paths: string[] = [];
function freshStore(): SearchStore {
  const path = `/tmp/bindersnap-search-${randomUUID()}.db`;
  paths.push(path);
  return new SearchStore(path);
}
afterEach(() => {
  for (const path of paths.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true });
  }
});

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";

function response(data: unknown, status = 200) {
  return status >= 400
    ? {
        data: undefined,
        error: { message: "No" },
        response: new Response(null, { status }),
      }
    : { data, error: undefined, response: new Response(null, { status }) };
}

/** One organization with one binder, whose `main` and files a test can move. */
function gitea(state: {
  main: string | null;
  files: Record<string, { sha: string; text: string }>;
  repos?: unknown[] | null;
}) {
  const reads: string[] = [];
  const client = {
    GET: mock(
      async (
        path: string,
        init: {
          params?: {
            path?: Record<string, string>;
            query?: Record<string, unknown>;
          };
        },
      ) => {
        const args = init.params?.path ?? {};
        if (path === "/orgs/{org}/repos") {
          return state.repos === null
            ? response(null, 404)
            : response(
                state.repos ?? [
                  {
                    id: 10,
                    name: "clinical",
                    owner: { id: 7, login: "riverside" },
                  },
                ],
              );
        }
        if (path === "/repos/{owner}/{repo}/branches/{branch}") {
          return state.main === null
            ? response(null, 404)
            : response({ commit: { id: state.main } });
        }
        if (path === "/repos/{owner}/{repo}/git/trees/{sha}") {
          return response({
            tree: Object.entries(state.files).map(([file, { sha }]) => ({
              path: file,
              type: "blob",
              sha,
              size: 1,
            })),
          });
        }
        if (path === "/repos/{owner}/{repo}/raw/{filepath}") {
          reads.push(String(args.filepath));
          const file = state.files[String(args.filepath)];
          if (!file) return response(null, 404);
          return response(new TextEncoder().encode(file.text).buffer);
        }
        return response([]);
      },
    ),
  } as unknown as GiteaClient;
  return { client, reads };
}

const organizations = [{ giteaOrgId: 7, name: "riverside" }];

function names(store: SearchStore, query: string) {
  return store
    .search({ query, repoIds: [10], limit: 8 })
    .hits.map((hit) => hit.document.name);
}

describe("sweepSearchIndex", () => {
  test("reads what is on main, then only what changed", async () => {
    const store = freshStore();
    const state = {
      main: "c1",
      files: {
        [`hand-hygiene.${UID}.md`]: { sha: "b1", text: "# Hand\n\nUse soap." },
        [`forms/intake.${UID.replace("D", "E")}.xlsx`]: { sha: "b2", text: "" },
      } as Record<string, { sha: string; text: string }>,
    };
    const { client, reads } = gitea(state);

    const first = await sweepSearchIndex({ client, store, organizations });
    expect(first).toMatchObject({
      binders: 1,
      changed: 1,
      files: 1,
      errors: [],
    });
    expect(names(store, '"soap"*')).toEqual(["hand-hygiene"]);
    // A spreadsheet is not read, and is still found by its name.
    expect(names(store, '"intake"*')).toEqual(["intake"]);

    // Nothing moved: nothing is read.
    reads.length = 0;
    const second = await sweepSearchIndex({ client, store, organizations });
    expect(second).toMatchObject({ changed: 0, files: 0 });
    expect(reads).toEqual([]);

    // A new version of one file: only that file is read.
    state.main = "c2";
    state.files[`hand-hygiene.${UID}.md`] = { sha: "b3", text: "Use gel." };
    const third = await sweepSearchIndex({ client, store, organizations });
    expect(third).toMatchObject({ changed: 1, files: 1 });
    expect(reads).toEqual([`hand-hygiene.${UID}.md`]);
    expect(names(store, '"soap"*')).toEqual([]);
    expect(names(store, '"gel"*')).toEqual(["hand-hygiene"]);
  });

  test("a renamed policy is not read again", async () => {
    const store = freshStore();
    const state = {
      main: "c1",
      files: {
        [`hand-hygiene.${UID}.md`]: { sha: "b1", text: "Use soap." },
      } as Record<string, { sha: string; text: string }>,
    };
    const { client, reads } = gitea(state);
    await sweepSearchIndex({ client, store, organizations });

    state.main = "c2";
    state.files = {
      [`clinical/handwashing.${UID}.md`]: { sha: "b1", text: "Use soap." },
    };
    reads.length = 0;
    await sweepSearchIndex({ client, store, organizations });
    expect(reads).toEqual([]);
    expect(names(store, '"soap"*')).toEqual(["handwashing"]);
  });

  test("a file that will not open is found by its title, and named", async () => {
    const store = freshStore();
    const { client } = gitea({
      main: "c1",
      files: { [`broken.${UID}.json`]: { sha: "b1", text: "{not json" } },
    });
    const pass = await sweepSearchIndex({ client, store, organizations });
    expect(pass.errors).toHaveLength(1);
    expect(pass.errors[0]).toMatchObject({ path: `broken.${UID}.json` });
    expect(names(store, '"broken"*')).toEqual(["broken"]);
  });

  test("an organization Gitea no longer has loses its binders", async () => {
    const store = freshStore();
    const state = {
      main: "c1",
      files: { [`a.${UID}.md`]: { sha: "b1", text: "x" } },
      repos: undefined as unknown[] | null | undefined,
    };
    const { client } = gitea(state);
    await sweepSearchIndex({ client, store, organizations });
    // Not on the API's list, but Gitea still has it: kept.
    await sweepSearchIndex({ client, store, organizations: [] });
    expect(store.counts().binders).toBe(1);
    // Gone from Gitea: dropped.
    state.repos = null;
    await sweepSearchIndex({ client, store, organizations: [] });
    expect(store.counts()).toMatchObject({ binders: 0, documents: 0 });
  });

  test("a binder with no commits is indexed as empty", async () => {
    const store = freshStore();
    const { client } = gitea({ main: null, files: {} });
    await sweepSearchIndex({ client, store, organizations });
    expect(store.indexedRepoIds([10])).toEqual(new Set([10]));
  });
});
