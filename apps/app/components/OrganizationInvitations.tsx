import { useEffect, useState } from "react";

import {
  fetchInvitations,
  inviteToOrganization,
  resendInvitation,
  revokeInvitation,
} from "../api";
import type {
  BinderLevel,
  InvitationRow,
} from "../../../packages/api-schema/schemas/invitations";

// Each says what it costs, since a writer's seat is billed once they accept.
const LEVELS: ReadonlyArray<{ value: BinderLevel; label: string }> = [
  { value: "reviewer", label: "Reviewer (free)" },
  { value: "editor", label: "Editor (uses a seat)" },
  { value: "admin", label: "Admin (uses a seat)" },
];

function sentAgo(createdAt: number, now = Date.now()): string {
  const days = Math.floor((now - createdAt) / (24 * 60 * 60_000));
  if (days <= 0) return "sent today";
  if (days === 1) return "sent yesterday";
  return `sent ${days} days ago`;
}

/**
 * Invite somebody by email, and the invitations still waiting.
 *
 * The way in for somebody with no account, and for anybody who should agree
 * before they are in. **The optional binder is the reason invitations work**
 * (docs/design/org-access-ux.md §5): somebody invited straight into a binder
 * as a reviewer arrives to a document waiting for them, not an empty product.
 */
export function OrganizationInvitations({
  org,
  orgName,
  binders,
  busy,
}: {
  org: string;
  orgName: string;
  binders: readonly string[];
  busy: boolean;
}) {
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [owner, setOwner] = useState(false);
  const [binder, setBinder] = useState("");
  const [level, setLevel] = useState<BinderLevel>("reviewer");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "saved" | "danger";
    text: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchInvitations(org)
      .then((next) => {
        if (!cancelled) setInvitations(next);
      })
      .catch(() => {
        if (!cancelled) setInvitations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  function failed(err: unknown, fallback: string) {
    setNotice({
      tone: "danger",
      text:
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : fallback,
    });
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (email.trim() === "") return;
    setSaving(true);
    setNotice(null);
    try {
      const row = await inviteToOrganization(org, {
        email,
        owner,
        ...(binder && !owner ? { binder, level } : {}),
      });
      setInvitations((current) => [
        ...(current ?? []).filter((entry) => entry.id !== row.id),
        row,
      ]);
      setNotice({ tone: "saved", text: `Invitation sent to ${row.email}.` });
      setEmail("");
      setOwner(false);
      setBinder("");
    } catch (err) {
      failed(err, "The invitation could not be sent.");
    } finally {
      setSaving(false);
    }
  }

  async function resend(row: InvitationRow) {
    setSaving(true);
    setNotice(null);
    try {
      const next = await resendInvitation(org, row.id);
      setInvitations((current) =>
        (current ?? []).map((entry) => (entry.id === row.id ? next : entry)),
      );
      setNotice({ tone: "saved", text: `Sent again to ${row.email}.` });
    } catch (err) {
      failed(err, "The invitation could not be sent again.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(row: InvitationRow) {
    setSaving(true);
    setNotice(null);
    try {
      await revokeInvitation(org, row.id);
      setInvitations((current) =>
        (current ?? []).filter((entry) => entry.id !== row.id),
      );
      setNotice({
        tone: "saved",
        text: `The invitation to ${row.email} no longer works.`,
      });
    } catch (err) {
      failed(err, "The invitation could not be withdrawn.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  return (
    <section className="bs-section" aria-labelledby="org-people-invite">
      <div className="bs-section-head">
        <h3 className="bs-section-title" id="org-people-invite">
          Invite by email
        </h3>
      </div>
      <form className="bs-fields" onSubmit={invite}>
        <label className="bs-field">
          <span className="bs-field-label">Email</span>
          <input
            className="bs-input bs-input--sm"
            type="email"
            value={email}
            placeholder="name@example.com"
            disabled={disabled}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <fieldset className="bs-field">
          <legend className="bs-field-label">Role</legend>
          <label className="bs-choice">
            <input
              type="radio"
              name="org-invite-role"
              checked={!owner}
              disabled={disabled}
              onChange={() => setOwner(false)}
            />
            <span>
              <span className="bs-choice-name">Member</span>
              <span className="bs-choice-note">Access is set per binder.</span>
            </span>
          </label>
          <label className="bs-choice">
            <input
              type="radio"
              name="org-invite-role"
              checked={owner}
              disabled={disabled}
              onChange={() => setOwner(true)}
            />
            <span>
              <span className="bs-choice-name">Owner</span>
              <span className="bs-choice-note">
                Can manage people, binders and billing. Uses a seat.
              </span>
            </span>
          </label>
        </fieldset>

        {owner || binders.length === 0 ? null : (
          <div className="bs-field">
            <span className="bs-field-label">Add to a binder (optional)</span>
            <div className="org-invite-binder">
              <select
                className="bs-input bs-input--sm"
                aria-label="Binder"
                value={binder}
                disabled={disabled}
                onChange={(event) => setBinder(event.target.value)}
              >
                <option value="">No binder</option>
                {binders.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                className="bs-input bs-input--sm"
                aria-label="As"
                value={level}
                disabled={disabled || binder === ""}
                onChange={(event) =>
                  setLevel(event.target.value as BinderLevel)
                }
              >
                {LEVELS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="org-people-actions">
          <button
            type="submit"
            className="bs-btn bs-btn-primary bs-btn--sm"
            disabled={disabled || email.trim() === ""}
          >
            {saving ? "Sending…" : "Send invitation"}
          </button>
        </div>
        <p className="bs-field-hint">
          We email them a link. Nothing changes in {orgName}, or on your bill,
          until they accept — and they can make an account on the way in.
        </p>
      </form>

      {notice ? (
        <p
          className={`bs-note${notice.tone === "danger" ? " bs-note--danger" : ""}`}
          role={notice.tone === "danger" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {invitations && invitations.length > 0 ? (
        <section className="bs-panel" aria-label="Pending invitations">
          <ul className="bs-row-list">
            {invitations.map((row) => (
              <li className="bs-row org-invitation-row" key={row.id}>
                <span className="bs-row-body">
                  <span className="bs-row-name">{row.email}</span>
                  <span className="bs-row-meta">
                    {row.grant.charAt(0).toUpperCase() + row.grant.slice(1)} ·{" "}
                    {row.status === "accepted"
                      ? "accepted, joining when an owner is next signed in"
                      : sentAgo(row.createdAt)}
                  </span>
                </span>
                {row.status === "pending" ? (
                  <span className="bs-row-right">
                    <button
                      type="button"
                      className="bs-btn bs-btn--quiet bs-btn--sm"
                      disabled={disabled}
                      onClick={() => void resend(row)}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      className="bs-btn bs-btn--quiet bs-btn--sm"
                      disabled={disabled}
                      onClick={() => void revoke(row)}
                    >
                      Revoke
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
