import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { emailVerifications } from "./db/schema";
import type { EmailContent } from "./mail/layout";

/**
 * Confirming an email address after signup (issue #665).
 *
 * Signup makes the account and signs the person in, but the API answers every
 * app route with `403 email_unverified` until they open the link it emailed.
 * Without this, anybody could sign up with somebody else's address — and an
 * invitation, a password reset and every change email go to whoever's address
 * an account claims.
 *
 * Three things prove the address and confirm it: the link, a password reset
 * (its link went to the same address), and signing up from an invitation sent
 * to that address.
 */

/** A link is good for a day. Asking again sends a new one. */
export const VERIFY_LINK_TTL_MS = 24 * 60 * 60_000;
/** One email per account per this long, however often somebody asks. */
export const VERIFY_EMAIL_COOLDOWN_MS = 60_000;

export function hashVerifyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function key(username: string): string {
  return username.trim().toLowerCase();
}

export type VerifyResult =
  | { ok: true; username: string; email: string }
  | { ok: false; reason: "unknown" | "expired" };

export class EmailVerificationStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  private row(username: string) {
    return (
      this.db
        .select()
        .from(emailVerifications)
        .where(eq(emailVerifications.username, key(username)))
        .get() ?? null
    );
  }

  /**
   * Whether this account still has to confirm its address. An account with no
   * row predates confirmation, and does not.
   */
  isUnconfirmed(username: string): boolean {
    const row = this.row(username);
    return row !== null && row.verifiedAt === null;
  }

  /** The address waiting to be confirmed, or null if there is none. */
  pendingAddress(username: string): string | null {
    const row = this.row(username);
    return row && row.verifiedAt === null ? row.email : null;
  }

  /**
   * A new link for this account and address, replacing any earlier one. With
   * `confirmed`, the address is already proven (an invitation sent to it), and
   * no link is needed — the token is still returned, unused.
   */
  start(
    username: string,
    email: string,
    { confirmed = false, now = Date.now() } = {},
  ): string {
    const token = randomBytes(32).toString("base64url");
    const values = {
      email,
      tokenHash: hashVerifyToken(token),
      sentAt: now,
      expiresAt: now + VERIFY_LINK_TTL_MS,
      verifiedAt: confirmed ? now : null,
    };
    this.db
      .insert(emailVerifications)
      .values({ username: key(username), ...values })
      .onConflictDoUpdate({ target: emailVerifications.username, set: values })
      .run();
    return token;
  }

  /**
   * A fresh link for an account still waiting, or null: confirmed already,
   * never asked, or one went out too recently to send another.
   */
  resend(
    username: string,
    now = Date.now(),
  ): { token: string; email: string } | "cooldown" | null {
    const row = this.row(username);
    if (!row || row.verifiedAt !== null) return null;
    if (row.sentAt > now - VERIFY_EMAIL_COOLDOWN_MS) return "cooldown";
    return {
      token: this.start(username, row.email, { now }),
      email: row.email,
    };
  }

  /**
   * Confirm the address a link was sent to. Opening a link that already did
   * its job says so again rather than failing: the second tab, or a mail
   * scanner that got there first, must not tell the person it did not work.
   */
  verify(token: string, now = Date.now()): VerifyResult {
    const row =
      this.db
        .select()
        .from(emailVerifications)
        .where(eq(emailVerifications.tokenHash, hashVerifyToken(token)))
        .get() ?? null;
    if (!row) return { ok: false, reason: "unknown" };
    if (row.verifiedAt !== null) {
      return { ok: true, username: row.username, email: row.email };
    }
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };
    this.db
      .update(emailVerifications)
      .set({ verifiedAt: now })
      .where(
        and(
          eq(emailVerifications.username, row.username),
          isNull(emailVerifications.verifiedAt),
        ),
      )
      .run();
    return { ok: true, username: row.username, email: row.email };
  }

  /**
   * Confirm without a link, when something else proved the address: a
   * password reset sent to it. Only if it is still the address waiting.
   */
  confirm(username: string, email: string, now = Date.now()): void {
    const row = this.row(username);
    if (!row || row.verifiedAt !== null) return;
    if (row.email.trim().toLowerCase() !== email.trim().toLowerCase()) return;
    this.db
      .update(emailVerifications)
      .set({ verifiedAt: now })
      .where(eq(emailVerifications.username, key(username)))
      .run();
  }

  /** Forget an account, when it is deleted. */
  forget(username: string): void {
    this.db
      .delete(emailVerifications)
      .where(eq(emailVerifications.username, key(username)))
      .run();
  }
}

let store: EmailVerificationStore | null = null;

export function emailVerificationStore(): EmailVerificationStore {
  store ??= new EmailVerificationStore();
  return store;
}

export function verifyEmailContent(params: {
  link: string;
  username: string;
}): EmailContent {
  return {
    subject: "Confirm your email for Bindersnap",
    preview: "One click, and your account is ready.",
    heading: "Confirm your email address",
    paragraphs: [
      `Welcome to Bindersnap. You signed up as ${params.username} with this address.`,
      "Confirm it is yours with the button below, and your account is ready to use.",
    ],
    action: { label: "Confirm my email", url: params.link },
    footnotes: [
      "The link works for the next 24 hours. Once you are signed in, you can send a new one.",
      "If you did not sign up for Bindersnap, ignore this email. The account cannot be used without this confirmation.",
    ],
  };
}
