import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import {
  OrganizationSettingsStore,
  PRODUCT_NEW_BINDER_DEFAULTS,
} from "./organization-settings";

let dbPath: string;
let store: OrganizationSettingsStore;

beforeEach(() => {
  dbPath = `/tmp/bindersnap-organization-settings-${randomUUID()}.sqlite`;
  store = new OrganizationSettingsStore(dbPath);
});

afterEach(() => {
  rmSync(dbPath, { force: true });
});

test("an organization that chose nothing starts binders as the product does", async () => {
  expect(await store.newBinderDefaults(77)).toEqual(
    PRODUCT_NEW_BINDER_DEFAULTS,
  );
  // The product's own: a new binder can publish until somebody raises it.
  expect(PRODUCT_NEW_BINDER_DEFAULTS).toEqual({
    requiredApprovals: 0,
    dismissStaleApprovals: true,
    blockOnUnresolvedThreads: false,
  });
});

test("changing one default keeps the others", async () => {
  await store.setNewBinderDefaults({
    giteaOrgId: 77,
    defaults: { requiredApprovals: 2 },
    changedBy: "alice",
  });
  const after = await store.setNewBinderDefaults({
    giteaOrgId: 77,
    defaults: { blockOnUnresolvedThreads: true },
    changedBy: "alice",
  });
  expect(after).toEqual({
    requiredApprovals: 2,
    dismissStaleApprovals: true,
    blockOnUnresolvedThreads: true,
  });
  expect(await store.newBinderDefaults(77)).toEqual(after);
  // And another organization's are its own.
  expect(await store.newBinderDefaults(78)).toEqual(
    PRODUCT_NEW_BINDER_DEFAULTS,
  );
});
