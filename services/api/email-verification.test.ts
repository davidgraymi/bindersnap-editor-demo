import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EmailVerificationStore,
  VERIFY_EMAIL_COOLDOWN_MS,
  VERIFY_LINK_TTL_MS,
  verifyEmailContent,
} from "./email-verification";

function freshStore() {
  return new EmailVerificationStore(
    join(mkdtempSync(join(tmpdir(), "verify-")), "verify.db"),
  );
}

test("an account with no row predates confirmation, and counts as confirmed", () => {
  const store = freshStore();
  expect(store.isUnconfirmed("alice")).toBe(false);
  expect(store.pendingAddress("alice")).toBeNull();
});

test("signup waits on the link, and the link confirms it", () => {
  const store = freshStore();
  const token = store.start("JKim", "jordan@example.com", { now: 0 });
  expect(store.isUnconfirmed("jkim")).toBe(true);
  expect(store.pendingAddress("jkim")).toBe("jordan@example.com");

  expect(store.verify(token, 1)).toEqual({
    ok: true,
    username: "jkim",
    email: "jordan@example.com",
  });
  expect(store.isUnconfirmed("JKIM")).toBe(false);
});

test("opening the link again still says confirmed, even after it would expire", () => {
  const store = freshStore();
  const token = store.start("jkim", "jordan@example.com", { now: 0 });
  store.verify(token, 1);
  expect(store.verify(token, VERIFY_LINK_TTL_MS * 2).ok).toBe(true);
});

test("a link works for a day, and a made-up one never", () => {
  const store = freshStore();
  const token = store.start("jkim", "jordan@example.com", { now: 0 });
  expect(store.verify(token, VERIFY_LINK_TTL_MS)).toEqual({
    ok: false,
    reason: "expired",
  });
  expect(store.verify("guess", 1)).toEqual({ ok: false, reason: "unknown" });
  expect(store.isUnconfirmed("jkim")).toBe(true);
});

test("a new link retires the earlier one, and not more than once a minute", () => {
  const store = freshStore();
  const first = store.start("jkim", "jordan@example.com", { now: 0 });
  expect(store.resend("jkim", VERIFY_EMAIL_COOLDOWN_MS - 1)).toBe("cooldown");

  const again = store.resend("jkim", VERIFY_EMAIL_COOLDOWN_MS);
  expect(again).toMatchObject({ email: "jordan@example.com" });
  expect(store.verify(first, VERIFY_EMAIL_COOLDOWN_MS + 1).ok).toBe(false);
  const { token } = again as { token: string };
  expect(store.verify(token, VERIFY_EMAIL_COOLDOWN_MS + 1).ok).toBe(true);

  // Confirmed, there is nothing to resend.
  expect(store.resend("jkim", VERIFY_EMAIL_COOLDOWN_MS * 3)).toBeNull();
});

test("an invitation to the same address confirms it at signup", () => {
  const store = freshStore();
  store.start("jkim", "jordan@example.com", { confirmed: true, now: 0 });
  expect(store.isUnconfirmed("jkim")).toBe(false);
});

test("a password reset confirms the address it was sent to, and no other", () => {
  const store = freshStore();
  store.start("jkim", "jordan@example.com", { now: 0 });
  store.confirm("jkim", "someone@else.com", 1);
  expect(store.isUnconfirmed("jkim")).toBe(true);
  store.confirm("jkim", "Jordan@Example.com", 2);
  expect(store.isUnconfirmed("jkim")).toBe(false);
});

test("a deleted account's login starts over", () => {
  const store = freshStore();
  store.start("jkim", "jordan@example.com", { now: 0 });
  store.forget("jkim");
  expect(store.isUnconfirmed("jkim")).toBe(false);
});

test("the email names the account and carries the link", () => {
  const content = verifyEmailContent({
    link: "https://app.example/-/verify_email?token=abc",
    username: "jkim",
  });
  expect(content.paragraphs.join(" ")).toContain("jkim");
  expect(content.action?.url).toBe(
    "https://app.example/-/verify_email?token=abc",
  );
});
