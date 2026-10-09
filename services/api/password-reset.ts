import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { passwordResets } from "./db/schema";
import type { EmailContent } from "./mail/layout";

/**
 * "Forgot password?" (issue #665).
 *
 * A person who cannot sign in gives an email address; if it is an account's,
 * that address gets a link carrying a random token. The link opens
 * `/-/reset_password` in the app, which sends the token back with a new
 * password, and the API sets it in Gitea with the admin token — the same way
 * change-password does, since Gitea has no "reset my own password" API.
 */

/** A link is good for an hour. */
export const RESET_LINK_TTL_MS = 60 * 60_000;
/** One email per account per this long, however often somebody asks. */
export const RESET_EMAIL_COOLDOWN_MS = 2 * 60_000;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface ResetRecord {
  username: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export class PasswordResetStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /**
   * Whether this account was sent a link too recently to send another. Stops
   * the form being used to fill somebody's inbox.
   */
  recentlySent(username: string, now = Date.now()): boolean {
    const row = this.db
      .select({ createdAt: passwordResets.createdAt })
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.username, username),
          gt(passwordResets.createdAt, now - RESET_EMAIL_COOLDOWN_MS),
        ),
      )
      .get();
    return Boolean(row);
  }

  /** A new link for this account; every earlier one stops working. */
  issue(username: string, email: string, now = Date.now()): string {
    const token = newResetToken();
    this.retireAll(username, now);
    this.db
      .insert(passwordResets)
      .values({
        tokenHash: hashResetToken(token),
        username,
        email,
        createdAt: now,
        expiresAt: now + RESET_LINK_TTL_MS,
        usedAt: null,
      })
      .run();
    return token;
  }

  /** The account a still-good token belongs to, without using it up. */
  peek(token: string, now = Date.now()): ResetRecord | null {
    const row = this.db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, hashResetToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Use a token up. One statement, so two requests racing with the same link
   * cannot both get through: exactly one of them sees the row.
   */
  consume(token: string, now = Date.now()): ResetRecord | null {
    const row = this.db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, hashResetToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, now),
        ),
      )
      .returning()
      .get();
    return row ?? null;
  }

  /** Put a used token back, when the reset it was for did not happen. */
  release(token: string): void {
    this.db
      .update(passwordResets)
      .set({ usedAt: null })
      .where(eq(passwordResets.tokenHash, hashResetToken(token)))
      .run();
  }

  /** Retire every outstanding link this account has. */
  retireAll(username: string, now = Date.now()): void {
    this.db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.username, username),
          isNull(passwordResets.usedAt),
        ),
      )
      .run();
  }

  /** Forget links that are used or expired and more than a day old. */
  prune(now = Date.now()): void {
    const dayAgo = now - 24 * 60 * 60_000;
    this.db
      .delete(passwordResets)
      .where(
        and(
          lt(passwordResets.createdAt, dayAgo),
          or(lt(passwordResets.expiresAt, now), gt(passwordResets.usedAt, 0)),
        ),
      )
      .run();
  }
}

let store: PasswordResetStore | null = null;

export function passwordResetStore(): PasswordResetStore {
  store ??= new PasswordResetStore();
  return store;
}

export function resetLinkEmail(params: {
  link: string;
  username: string;
}): EmailContent {
  return {
    subject: "Reset your Bindersnap password",
    preview: "This link works once, for the next hour.",
    heading: "Reset your password",
    paragraphs: [
      `Somebody — hopefully you — asked to reset the password for the Bindersnap account ${params.username}.`,
      "Choose a new one with the button below. Signing in with it signs you out everywhere else.",
    ],
    action: { label: "Choose a new password", url: params.link },
    footnotes: [
      "The link works once, for the next hour.",
      "If you did not ask for this, ignore this email. Your password stays as it is.",
    ],
  };
}

export function passwordChangedEmail(params: {
  username: string;
  signInUrl: string;
}): EmailContent {
  return {
    subject: "Your Bindersnap password was changed",
    heading: "Your password was changed",
    paragraphs: [
      `The password for the Bindersnap account ${params.username} was just reset, and every other device was signed out.`,
      "If this was you, there is nothing more to do.",
      "If it was not, reset it again straight away from the sign-in page, and tell your organization's owner.",
    ],
    action: { label: "Go to sign in", url: params.signInUrl },
  };
}
