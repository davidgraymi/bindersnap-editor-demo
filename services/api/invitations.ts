import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { organizationInvitations } from "./db/schema";
import type { EmailContent } from "./mail/layout";

/**
 * Invitations into an organization by email (issue #426). See the table's
 * comment in db/schema.ts for the three rules, and server.ts for the routes.
 */

/** An invitation is good for two weeks. */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60_000;

export type OrgRole = "owner" | "member";
export type BinderLevel = "admin" | "editor" | "reviewer";

export type InvitationStatus =
  "pending" | "accepted" | "joined" | "revoked" | "expired";

export interface Invitation {
  id: string;
  giteaOrgId: number;
  orgName: string;
  email: string;
  orgRole: OrgRole;
  binder: string | null;
  binderLevel: BinderLevel | null;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  acceptedAt: number | null;
  acceptedBy: string | null;
  joinedAt: number | null;
}

export function invitationStatus(
  invitation: Invitation,
  now = Date.now(),
): InvitationStatus {
  if (invitation.joinedAt !== null) return "joined";
  if (invitation.acceptedAt !== null) return "accepted";
  if (invitation.revokedAt !== null) return "revoked";
  if (invitation.expiresAt <= now) return "expired";
  return "pending";
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** `p•••@riverside.health`: enough to recognise, not enough to harvest. */
export function maskAddress(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}•••${email.slice(at)}`;
}

function toInvitation(
  row: typeof organizationInvitations.$inferSelect,
): Invitation {
  const { tokenHash: _tokenHash, ...rest } = row;
  return {
    ...rest,
    orgRole: row.orgRole as OrgRole,
    binderLevel: row.binderLevel as BinderLevel | null,
  };
}

export class InvitationStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /** A new invitation and the token for its link. */
  create(
    params: {
      giteaOrgId: number;
      orgName: string;
      email: string;
      orgRole: OrgRole;
      binder: string | null;
      binderLevel: BinderLevel | null;
      invitedBy: string;
    },
    now = Date.now(),
  ): { invitation: Invitation; token: string } {
    const token = randomBytes(32).toString("base64url");
    const row = this.db
      .insert(organizationInvitations)
      .values({
        id: randomUUID(),
        tokenHash: hashInvitationToken(token),
        ...params,
        email: params.email.trim(),
        createdAt: now,
        expiresAt: now + INVITATION_TTL_MS,
        revokedAt: null,
        acceptedAt: null,
        acceptedBy: null,
        joinedAt: null,
      })
      .returning()
      .get();
    return { invitation: toInvitation(row), token };
  }

  get(id: string): Invitation | null {
    const row = this.db
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, id))
      .get();
    return row ? toInvitation(row) : null;
  }

  byToken(token: string): Invitation | null {
    const row = this.db
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.tokenHash, hashInvitationToken(token)))
      .get();
    return row ? toInvitation(row) : null;
  }

  /** Invitations an owner should see: not yet joined, revoked or expired. */
  open(giteaOrgId: number, now = Date.now()): Invitation[] {
    return this.db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.giteaOrgId, giteaOrgId),
          isNull(organizationInvitations.revokedAt),
          isNull(organizationInvitations.joinedAt),
          gt(organizationInvitations.expiresAt, now),
        ),
      )
      .orderBy(organizationInvitations.createdAt)
      .all()
      .map(toInvitation);
  }

  /** The still-open invitation for this address, if one was already sent. */
  openFor(
    giteaOrgId: number,
    email: string,
    now = Date.now(),
  ): Invitation | null {
    return (
      this.open(giteaOrgId, now).find((invitation) =>
        sameAddress(invitation.email, email),
      ) ?? null
    );
  }

  /** A fresh token and two more weeks, for Resend. The old link stops working. */
  renew(id: string, now = Date.now()): string {
    const token = randomBytes(32).toString("base64url");
    this.db
      .update(organizationInvitations)
      .set({
        tokenHash: hashInvitationToken(token),
        expiresAt: now + INVITATION_TTL_MS,
      })
      .where(eq(organizationInvitations.id, id))
      .run();
    return token;
  }

  revoke(id: string, now = Date.now()): boolean {
    const row = this.db
      .update(organizationInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(organizationInvitations.id, id),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
        ),
      )
      .returning({ id: organizationInvitations.id })
      .get();
    return Boolean(row);
  }

  /**
   * Accept, once. One statement, so two tabs cannot both accept, and an
   * invitation revoked or expired a moment ago cannot be.
   */
  accept(id: string, username: string, now = Date.now()): Invitation | null {
    const row = this.db
      .update(organizationInvitations)
      .set({ acceptedAt: now, acceptedBy: username })
      .where(
        and(
          eq(organizationInvitations.id, id),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
          gt(organizationInvitations.expiresAt, now),
        ),
      )
      .returning()
      .get();
    return row ? toInvitation(row) : null;
  }

  markJoined(id: string, now = Date.now()): void {
    this.db
      .update(organizationInvitations)
      .set({ joinedAt: now })
      .where(eq(organizationInvitations.id, id))
      .run();
  }

  /** Accepted, but no owner was signed in to add them yet. */
  waitingToJoin(): Invitation[] {
    return this.db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          isNotNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.joinedAt),
        ),
      )
      .all()
      .map(toInvitation);
  }
}

let store: InvitationStore | null = null;

export function invitationStore(): InvitationStore {
  store ??= new InvitationStore();
  return store;
}

const LEVEL_WORDS: Record<BinderLevel, string> = {
  admin: "an admin",
  editor: "an editor",
  reviewer: "a reviewer",
};

/** What the invitation gives, in one phrase: "a reviewer in Clinical Policies". */
export function describeGrant(
  invitation: Pick<Invitation, "orgRole" | "binder" | "binderLevel">,
): string {
  if (invitation.orgRole === "owner") return "an owner";
  if (invitation.binder && invitation.binderLevel) {
    return `${LEVEL_WORDS[invitation.binderLevel]} in ${invitation.binder}`;
  }
  return "a member";
}

export function invitationEmail(params: {
  inviterName: string;
  orgName: string;
  grant: string;
  email: string;
  link: string;
}): EmailContent {
  return {
    subject: `${params.inviterName} invited you to ${params.orgName} on Bindersnap`,
    preview: `Join ${params.orgName} as ${params.grant}.`,
    heading: `Join ${params.orgName} on Bindersnap`,
    paragraphs: [
      `${params.inviterName} invited you to join ${params.orgName} as ${params.grant}.`,
      "Bindersnap is where your organization keeps its documents, and the record of who approved each version. If you do not have an account yet, you can make one on the way in.",
    ],
    action: { label: "Accept the invitation", url: params.link },
    footnotes: [
      `The invitation is for ${params.email}, and works for two weeks.`,
      "Not expecting this? Ignore it, and nothing changes.",
    ],
  };
}
