import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hashResetToken,
  PasswordResetStore,
  RESET_EMAIL_COOLDOWN_MS,
  RESET_LINK_TTL_MS,
  resetLinkEmail,
} from "./password-reset";

function freshStore() {
  return new PasswordResetStore(
    join(mkdtempSync(join(tmpdir(), "resets-")), "resets.db"),
  );
}

test("a link works once", () => {
  const store = freshStore();
  const token = store.issue("jkim", "jordan@example.com", 0);
  expect(store.peek(token, 1)?.username).toBe("jkim");
  expect(store.consume(token, 1)?.username).toBe("jkim");
  expect(store.consume(token, 2)).toBeNull();
  expect(store.peek(token, 2)).toBeNull();
});

test("a link works for an hour, and not a moment longer", () => {
  const store = freshStore();
  const token = store.issue("jkim", "jordan@example.com", 0);
  expect(store.peek(token, RESET_LINK_TTL_MS - 1)).not.toBeNull();
  expect(store.consume(token, RESET_LINK_TTL_MS)).toBeNull();
});

test("asking again retires the earlier link", () => {
  const store = freshStore();
  const first = store.issue("jkim", "jordan@example.com", 0);
  const second = store.issue("jkim", "jordan@example.com", 10);
  expect(store.peek(first, 11)).toBeNull();
  expect(store.peek(second, 11)).not.toBeNull();
});

test("a reset that did not happen puts its link back", () => {
  const store = freshStore();
  const token = store.issue("jkim", "jordan@example.com", 0);
  store.consume(token, 1);
  store.release(token);
  expect(store.consume(token, 2)?.username).toBe("jkim");
});

test("only a hash of the token is stored", () => {
  const token = freshStore().issue("jkim", "jordan@example.com", 0);
  expect(token.length).toBeGreaterThanOrEqual(43);
  expect(hashResetToken(token)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashResetToken(token)).not.toContain(token);
});

test("one email per account per cooldown, however often somebody asks", () => {
  const store = freshStore();
  store.issue("jkim", "jordan@example.com", 0);
  expect(store.recentlySent("jkim", RESET_EMAIL_COOLDOWN_MS - 1)).toBe(true);
  expect(store.recentlySent("jkim", RESET_EMAIL_COOLDOWN_MS + 1)).toBe(false);
  expect(store.recentlySent("someone-else", 1)).toBe(false);
});

test("the reset email carries the link and says how long it lasts", () => {
  const content = resetLinkEmail({
    link: "https://bindersnap.com/-/reset_password?token=abc",
    username: "jkim",
  });
  expect(content.action?.url).toBe(
    "https://bindersnap.com/-/reset_password?token=abc",
  );
  expect(content.footnotes?.join(" ")).toContain("next hour");
});
