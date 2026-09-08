import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import {
  DEFAULT_WORKSPACE_SETTINGS,
  WorkspaceSettingsStore,
} from "./workspace-settings";

/**
 * The table that replaced the `bindersnap-config` branch.
 *
 * The file it replaces degraded **silently to the permissive policy** when it
 * could not be parsed — a corrupt byte turned a control off and said nothing.
 * These tests are mostly about the two properties that failure mode cost:
 * a binder with no row has a known default rather than an unknown one, and
 * every change to a rule is recorded.
 */

let dbPath: string;
let store: WorkspaceSettingsStore;

const BINDER = {
  giteaRepoId: 4211,
  organization: "riverside-health",
  workspace: "clinical",
};

beforeEach(() => {
  dbPath = `/tmp/bindersnap-workspace-settings-${randomUUID()}.sqlite`;
  store = new WorkspaceSettingsStore(dbPath);
});

afterEach(() => {
  rmSync(dbPath, { force: true });
});

describe("reading", () => {
  test("a binder nobody has configured has no row", async () => {
    // Null rather than a fabricated row: "nobody has chosen" and "somebody
    // chose the default" are different facts, and the screen says different
    // things about them.
    expect(await store.get(BINDER.giteaRepoId)).toBeNull();
  });

  test("the default is permissive, and that is the argued choice", async () => {
    // A binder that blocked publishing on unresolved threads by default would
    // stop every first publish for a reason nobody had chosen. The setting
    // exists to be turned on.
    expect(DEFAULT_WORKSPACE_SETTINGS.blockOnUnresolvedThreads).toBe(false);
  });
});

describe("writing", () => {
  test("a setting is stored and read back", async () => {
    await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });

    expect(await store.get(BINDER.giteaRepoId)).toMatchObject({
      giteaRepoId: BINDER.giteaRepoId,
      organization: "riverside-health",
      workspace: "clinical",
      blockOnUnresolvedThreads: true,
      updatedAt: 1_700_000_000,
    });
  });

  test("the first write records the change, with no previous value", async () => {
    const events = await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });

    expect(events).toEqual([
      {
        giteaRepoId: BINDER.giteaRepoId,
        setting: "blockOnUnresolvedThreads",
        previousValue: null,
        newValue: "true",
        changedBy: "alice",
        changedAt: 1_700_000_000,
      },
    ]);
  });

  test("relaxing a rule is recorded, which is the point of the table", async () => {
    // ADR 0004 names this case specifically: "who relaxed the thread
    // requirement, and when".
    await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });
    const events = await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: false },
      changedBy: "bob",
      now: 1_700_000_100,
    });

    expect(events[0]).toMatchObject({
      previousValue: "true",
      newValue: "false",
      changedBy: "bob",
    });
  });

  test("a write that changes nothing records nothing", async () => {
    // A trail full of "set X to X" is a trail nobody reads.
    await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });

    const events = await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_100,
    });

    expect(events).toEqual([]);
    expect(await store.history(BINDER.giteaRepoId)).toHaveLength(1);
  });

  test("a write that changes nothing still refreshes the names", async () => {
    // Gitea renames repositories, and the name here is a display cache. It is
    // refreshed whenever anybody touches the rules, so it stops being stale
    // without anything having to watch for a rename.
    await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });

    await store.set({
      giteaRepoId: BINDER.giteaRepoId,
      organization: "riverside-health",
      workspace: "clinical-policies",
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_100,
    });

    expect(await store.get(BINDER.giteaRepoId)).toMatchObject({
      workspace: "clinical-policies",
      updatedAt: 1_700_000_100,
    });
  });

  test("an empty change keeps what is already there", async () => {
    await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });

    await store.set({
      ...BINDER,
      settings: {},
      changedBy: "alice",
      now: 1_700_000_100,
    });

    expect(
      (await store.get(BINDER.giteaRepoId))?.blockOnUnresolvedThreads,
    ).toBe(true);
  });
});

describe("the administrative trail", () => {
  test("history is newest first", async () => {
    for (const [index, value] of [true, false, true].entries()) {
      await store.set({
        ...BINDER,
        settings: { blockOnUnresolvedThreads: value },
        changedBy: `person-${index}`,
        now: 1_700_000_000 + index,
      });
    }

    const history = await store.history(BINDER.giteaRepoId);
    expect(history.map((event) => event.changedBy)).toEqual([
      "person-2",
      "person-1",
      "person-0",
    ]);
  });

  test("one binder's trail does not carry another's", async () => {
    await store.set({
      ...BINDER,
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "alice",
      now: 1_700_000_000,
    });
    await store.set({
      giteaRepoId: 9999,
      organization: "riverside-health",
      workspace: "corporate",
      settings: { blockOnUnresolvedThreads: true },
      changedBy: "bob",
      now: 1_700_000_100,
    });

    expect(await store.history(BINDER.giteaRepoId)).toHaveLength(1);
    expect(await store.history(9999)).toHaveLength(1);
  });

  test("history is capped, so one noisy binder cannot return everything", async () => {
    for (let index = 0; index < 6; index += 1) {
      await store.set({
        ...BINDER,
        settings: { blockOnUnresolvedThreads: index % 2 === 0 },
        changedBy: "alice",
        now: 1_700_000_000 + index,
      });
    }

    expect(await store.history(BINDER.giteaRepoId, 2)).toHaveLength(2);
  });
});
