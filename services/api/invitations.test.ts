import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  describeGrant,
  INVITATION_TTL_MS,
  invitationEmail,
  invitationStatus,
  InvitationStore,
  maskAddress,
} from "./invitations";

function freshStore() {
  return new InvitationStore(
    join(mkdtempSync(join(tmpdir(), "invites-")), "invites.db"),
  );
}

const base = {
  giteaOrgId: 7,
  orgName: "riverside",
  email: "Priya@Riverside.Health",
  orgRole: "member" as const,
  binder: "clinical",
  binderLevel: "reviewer" as const,
  invitedBy: "olivia",
};

test("an invitation is pending, found by its token, and the token is not stored", () => {
  const store = freshStore();
  const { invitation, token } = store.create(base, 0);
  expect(invitationStatus(invitation, 1)).toBe("pending");
  expect(store.byToken(token)?.id).toBe(invitation.id);
  expect(store.byToken("guess")).toBeNull();
  expect(JSON.stringify(invitation)).not.toContain(token);
});

test("it can be accepted once, and not after it expires or is revoked", () => {
  const store = freshStore();
  const first = store.create(base, 0).invitation;
  expect(store.accept(first.id, "priya", 1)?.acceptedBy).toBe("priya");
  expect(store.accept(first.id, "mallory", 2)).toBeNull();

  const late = store.create(base, 0).invitation;
  expect(store.accept(late.id, "priya", INVITATION_TTL_MS)).toBeNull();
  expect(invitationStatus(store.get(late.id)!, INVITATION_TTL_MS)).toBe(
    "expired",
  );

  const withdrawn = store.create(base, 0).invitation;
  expect(store.revoke(withdrawn.id, 1)).toBe(true);
  expect(store.accept(withdrawn.id, "priya", 2)).toBeNull();
  expect(invitationStatus(store.get(withdrawn.id)!)).toBe("revoked");
});

test("an accepted invitation cannot be revoked out from under the join", () => {
  const store = freshStore();
  const { invitation } = store.create(base, 0);
  store.accept(invitation.id, "priya", 1);
  expect(store.revoke(invitation.id, 2)).toBe(false);
});

test("accepted but not yet joined waits; joined is done", () => {
  const store = freshStore();
  const { invitation } = store.create(base, 0);
  store.accept(invitation.id, "priya", 1);
  expect(store.waitingToJoin().map((i) => i.id)).toEqual([invitation.id]);
  expect(invitationStatus(store.get(invitation.id)!)).toBe("accepted");
  store.markJoined(invitation.id, 2);
  expect(store.waitingToJoin()).toEqual([]);
  expect(invitationStatus(store.get(invitation.id)!)).toBe("joined");
});

test("resend retires the old link and gives two more weeks", () => {
  const store = freshStore();
  const { invitation, token } = store.create(base, 0);
  const fresh = store.renew(invitation.id, 1000);
  expect(store.byToken(token)).toBeNull();
  expect(store.byToken(fresh)?.expiresAt).toBe(1000 + INVITATION_TTL_MS);
});

test("an open invitation is found by address, whatever its case", () => {
  const store = freshStore();
  const { invitation } = store.create(base, 0);
  expect(store.openFor(7, "priya@riverside.health", 1)?.id).toBe(invitation.id);
  expect(store.openFor(8, "priya@riverside.health", 1)).toBeNull();
  expect(store.open(7, 1)).toHaveLength(1);
  store.revoke(invitation.id, 2);
  expect(store.open(7, 3)).toHaveLength(0);
});

test("the grant reads as a sentence", () => {
  expect(describeGrant(base)).toBe("a reviewer in clinical");
  expect(describeGrant({ ...base, binder: null, binderLevel: null })).toBe(
    "a member",
  );
  expect(describeGrant({ ...base, orgRole: "owner" })).toBe("an owner");
});

test("an address is masked to its first letter and domain", () => {
  expect(maskAddress("priya@riverside.health")).toBe("p•••@riverside.health");
});

test("the email says who, where, as what, and for which address", () => {
  const email = invitationEmail({
    inviterName: "Olivia Owens",
    orgName: "Riverside Health",
    grant: "a reviewer in clinical",
    email: "priya@riverside.health",
    link: "https://bindersnap.com/-/invitations/t?email=x",
  });
  expect(email.subject).toBe(
    "Olivia Owens invited you to Riverside Health on Bindersnap",
  );
  expect(email.paragraphs[0]).toContain("as a reviewer in clinical");
  expect(email.footnotes?.[0]).toContain("priya@riverside.health");
});
