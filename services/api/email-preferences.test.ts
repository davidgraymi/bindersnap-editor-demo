import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALL_ON,
  EmailPreferenceStore,
  parsePreferences,
} from "./email-preferences";

function freshStore() {
  return new EmailPreferenceStore(
    join(mkdtempSync(join(tmpdir(), "prefs-")), "prefs.db"),
  );
}

test("everything is on for somebody who never chose", () => {
  expect(freshStore().get("jkim")).toEqual(ALL_ON);
});

test("a choice sticks, and only the topics named change", () => {
  const store = freshStore();
  store.set("jkim", { published: false });
  expect(store.get("jkim")).toEqual({ ...ALL_ON, published: false });
  expect(store.wants("JKIM", "published")).toBe(false);
  expect(store.wants("jkim", "reviewRequested")).toBe(true);
});

test("the unsubscribe token is per person, stable, and turns everything off", () => {
  const store = freshStore();
  const token = store.tokenFor("jkim");
  expect(store.tokenFor("JKim")).toBe(token);
  expect(store.tokenFor("carol")).not.toBe(token);

  expect(store.unsubscribe(token)).toBe("jkim");
  expect(store.get("jkim")).toEqual({
    reviewRequested: false,
    changesRequested: false,
    readyToPublish: false,
    published: false,
  });
  expect(store.get("carol")).toEqual(ALL_ON);
  expect(store.unsubscribe("not-a-token")).toBeNull();
});

test("setting preferences keeps the token an email already carries", () => {
  const store = freshStore();
  const token = store.tokenFor("jkim");
  store.set("jkim", { reviewRequested: false });
  expect(store.tokenFor("jkim")).toBe(token);
});

test("a preferences body must be booleans", () => {
  expect(parsePreferences({ published: false, other: 1 })).toEqual({
    published: false,
  });
  expect(parsePreferences({ published: "no" })).toBeNull();
  expect(parsePreferences(null)).toBeNull();
});
