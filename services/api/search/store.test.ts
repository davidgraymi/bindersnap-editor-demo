import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import {
  MAX_PASSAGES,
  SearchStore,
  snippetParts,
  type DocumentInput,
} from "./store";

const paths: string[] = [];
function freshStore(): SearchStore {
  const path = `/tmp/bindersnap-search-${randomUUID()}.db`;
  paths.push(path);
  return new SearchStore(path);
}
afterEach(() => {
  for (const path of paths.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

function doc(
  name: string,
  texts: string[] | null,
  overrides: Partial<DocumentInput> = {},
): DocumentInput {
  return {
    path: `clinical/${name}.01J8XZ4K7MQ9V3B0RN7YHS2E1D.json`,
    uid: `uid-${name}`,
    slugPath: `clinical/${name}`,
    name,
    folder: "clinical",
    blobSha: `blob-${name}`,
    passages:
      texts?.map((text, ordinal) => ({ ordinal, heading: null, text })) ?? null,
    ...overrides,
  };
}

const binder = (documents: DocumentInput[], extra = {}) => ({
  repoId: 10,
  orgId: 7,
  owner: "riverside-health",
  name: "clinical",
  mainSha: "c1",
  documents,
  ...extra,
});

describe("SearchStore", () => {
  test("a title match comes before a match in the words, each document once", () => {
    const store = freshStore();
    store.writeBinder(
      binder([
        doc("hand-hygiene", ["Wash for twenty seconds."]),
        doc("infection-control", [
          "Follow the hand hygiene policy.",
          "Hand hygiene before and after care.",
        ]),
      ]),
    );

    const { hits, hasMore } = store.search({
      query: '"hand"* AND "hyg"*',
      repoIds: [10],
      limit: 8,
    });
    expect(hasMore).toBe(false);
    expect(hits.map((hit) => [hit.document.name, hit.matched])).toEqual([
      ["hand-hygiene", "title"],
      ["infection-control", "contents"],
    ]);
    const parts = hits[1]!.snippet!.parts;
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(
      ["hand", "hygiene"],
    );
  });

  test("only the binders asked for are searched", () => {
    const store = freshStore();
    store.writeBinder(binder([doc("hand-hygiene", ["soap"])]));
    store.writeBinder(
      binder([doc("other", ["soap"])], {
        repoId: 11,
        name: "hr",
        mainSha: "c9",
      }),
    );
    const names = (repoIds: number[]) =>
      store
        .search({ query: '"soap"*', repoIds, limit: 8 })
        .hits.map((hit) => hit.document.name);
    expect(names([11])).toEqual(["other"]);
    expect(names([])).toEqual([]);
  });

  test("the binder's name is where a document is filed, and finds it", () => {
    const store = freshStore();
    store.writeBinder(binder([doc("handover", null)]));
    const hits = store.search({ query: '"cl"*', repoIds: [10], limit: 8 }).hits;
    expect(hits.map((hit) => hit.document.name)).toEqual(["handover"]);
    expect(hits[0]!.document.contents).toBe(false);
  });

  test("a document that left main is gone; one kept unchanged keeps its words", () => {
    const store = freshStore();
    store.writeBinder(
      binder([doc("a", ["alpha words"]), doc("b", ["beta words"])]),
    );
    store.writeBinder(
      binder(
        [
          // Renamed and refiled, same blob: passages null, marked unchanged.
          doc("a-renamed", null, {
            uid: "uid-a",
            blobSha: "blob-a",
            unchanged: true,
          }),
        ],
        { mainSha: "c2" },
      ),
    );

    const search = (query: string) =>
      store
        .search({ query, repoIds: [10], limit: 8 })
        .hits.map((hit) => hit.document.name);
    expect(search('"alpha"*')).toEqual(["a-renamed"]);
    expect(search('"beta"*')).toEqual([]);
    expect(store.binder(10)?.mainSha).toBe("c2");
    expect(store.counts()).toMatchObject({
      documents: 1,
      passages: 1,
      binders: 1,
    });
  });

  test("a document read again loses its old words", () => {
    const store = freshStore();
    store.writeBinder(binder([doc("a", ["old words"])]));
    store.writeBinder(
      binder([doc("a", ["new words"], { blobSha: "blob-a2" })], {
        mainSha: "c2",
      }),
    );
    const search = (query: string) =>
      store.search({ query, repoIds: [10], limit: 8 }).hits.length;
    expect(search('"old"*')).toBe(0);
    expect(search('"new"*')).toBe(1);
  });

  test("passages past the cap are not indexed, and the document says so", () => {
    const store = freshStore();
    const many = Array.from({ length: MAX_PASSAGES + 3 }, (_, i) => `word${i}`);
    store.writeBinder(binder([doc("manual", many)]));
    const [document] = store.documentsOf(10);
    expect(document).toMatchObject({ passages: MAX_PASSAGES, truncated: true });
    expect(
      store.search({
        query: `"word${MAX_PASSAGES + 1}"`,
        repoIds: [10],
        limit: 8,
      }).hits,
    ).toEqual([]);
  });

  test("organizations number their rows in separate blocks", () => {
    const store = freshStore();
    store.writeBinder(binder([doc("a", ["x"])]));
    store.writeBinder(
      binder([doc("b", ["x"])], { repoId: 20, orgId: 8, owner: "lakeside" }),
    );
    const [a] = store.documentsOf(10);
    const [b] = store.documentsOf(20);
    expect(Math.floor(a!.id / 2 ** 20)).not.toBe(Math.floor(b!.id / 2 ** 20));
  });

  test("a binder renamed has its titles written under the new name", () => {
    const store = freshStore();
    store.writeBinder(binder([doc("handover", null)]));
    store.renameBinder(10, "riverside-health", "nursing");
    const found = (query: string) =>
      store.search({ query, repoIds: [10], limit: 8 }).hits.length;
    expect(found('"nursing"*')).toBe(1);
    expect(found('"clinical"*')).toBe(1); // still its folder
    store.removeBinder(10);
    expect(store.counts()).toMatchObject({ documents: 0, binders: 0 });
  });
});

describe("snippetParts", () => {
  test("marked stretches come back as matches", () => {
    expect(snippetParts("Use \u0002soap\u0003 and \u0002water\u0003")).toEqual([
      { text: "Use ", match: false },
      { text: "soap", match: true },
      { text: " and ", match: false },
      { text: "water", match: true },
    ]);
  });
});
