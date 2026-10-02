import { useEffect, useState } from "react";

import {
  AccountChangeRefused,
  changePassword,
  changeUsername,
  deleteAccount,
  fetchAccountBlockers,
  updateProfile,
} from "../api";
import type { SessionUser } from "../../../packages/api-schema/schemas/auth";
import type { AccountBlockers } from "../../../packages/api-schema/schemas/account";
import {
  joinFullName,
  splitFullName,
  validateFullName,
} from "../../../packages/utils/personName";
import { SettingsGroup } from "./SettingsGroup";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

/**
 * The signed-in person's own account: `/-/user_settings/profile`.
 *
 * Everything here is about one person rather than an organization, which is
 * why it hangs off the avatar menu and not the sidebar — the sidebar is
 * organized by organization, and an account belongs to none of them.
 */
export function AccountSettingsPage({
  user,
  onUserChanged,
  onDeleted,
}: {
  user: SessionUser | null;
  /** Read the session again, so every screen that names them catches up. */
  onUserChanged: () => void | Promise<unknown>;
  /** The account is gone; leave the signed-in app. */
  onDeleted: () => void | Promise<unknown>;
}) {
  // **What would refuse a rename or a deletion, read when the page opens.**
  // A button that can only be refused is drawn dimmed with the reason, the
  // way Approve and Publish are, rather than offered and then refused after
  // somebody has typed their password. Null while unknown: the server checks
  // again on every attempt, so the page never has to guess.
  const [blockers, setBlockers] = useState<AccountBlockers | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAccountBlockers()
      .then((next) => {
        if (!cancelled) setBlockers(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.username]);

  return (
    <div className="docw-page account-settings">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">Your account</h1>
          <p className="bs-subtitle">
            Signed in as <strong>{user?.username ?? ""}</strong>.
          </p>
        </div>
      </div>

      <div className="bs-settings">
        <SettingsGroup
          id="account-profile"
          title="Profile"
          note="The name every approval, comment and version of yours is signed with."
        >
          <ProfileName user={user} onSaved={onUserChanged} />
        </SettingsGroup>

        <SettingsGroup
          id="account-sign-in"
          title="Signing in"
          note="Your password and the username you sign in with."
        >
          <PasswordForm />
          <UsernameForm
            user={user}
            onSaved={onUserChanged}
            blocked={
              blockers?.serviceAccount
                ? {
                    reason:
                      "This account runs Bindersnap itself and cannot be renamed.",
                    list: [],
                  }
                : blockers && blockers.renameBlockedBy.length > 0
                  ? {
                      reason:
                        "Your username is in the sign-off rules of these binders. Change those rules to use a group, then rename.",
                      list: blockers.renameBlockedBy,
                    }
                  : null
            }
          />
        </SettingsGroup>

        <SettingsGroup
          id="account-delete"
          title="Delete your account"
          note="Permanent. What you approved and published stays on the record, under your name."
        >
          <DeleteAccountForm
            user={user}
            onDeleted={onDeleted}
            blocked={
              blockers?.serviceAccount
                ? {
                    reason:
                      "This account runs Bindersnap itself and cannot be deleted.",
                    list: [],
                  }
                : blockers && blockers.deleteBlockedBy.length > 0
                  ? {
                      reason:
                        "You are the only owner of these organizations. Make someone else an owner, or delete the organization, first.",
                      list: blockers.deleteBlockedBy,
                    }
                  : null
            }
          />
        </SettingsGroup>
      </div>
    </div>
  );
}

function ProfileName({
  user,
  onSaved,
}: {
  user: SessionUser | null;
  onSaved: () => void | Promise<unknown>;
}) {
  const stored = splitFullName(user?.fullName ?? "");
  const [first, setFirst] = useState(stored.first);
  const [last, setLast] = useState(stored.last);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "saved" | "danger";
    text: string;
  } | null>(null);

  const changed =
    joinFullName(first, last) !== joinFullName(stored.first, stored.last);

  async function save() {
    const problem = validateFullName(first, last);
    if (problem) {
      setNotice({ tone: "danger", text: problem });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await updateProfile({ first, last });
      await onSaved();
      setNotice({ tone: "saved", text: "Saved." });
    } catch (err) {
      setNotice({
        tone: "danger",
        text: errorMessage(err, "Your name could not be saved."),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="bs-fields"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="app-field-pair">
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="account-first-name">
            First name
          </label>
          <input
            className="bs-input bs-input--sm"
            id="account-first-name"
            type="text"
            autoComplete="given-name"
            value={first}
            disabled={saving}
            onChange={(event) => {
              setFirst(event.target.value);
              setNotice(null);
            }}
          />
        </div>
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="account-last-name">
            Last name
          </label>
          <input
            className="bs-input bs-input--sm"
            id="account-last-name"
            type="text"
            autoComplete="family-name"
            value={last}
            disabled={saving}
            onChange={(event) => {
              setLast(event.target.value);
              setNotice(null);
            }}
          />
        </div>
      </div>
      {/* The one thing somebody changing their name would want to know: what
          has already been signed keeps the name it was signed with. */}
      <p className="bs-field-hint">
        Versions already published keep the name they were approved under.
      </p>
      {notice ? (
        <p
          className={`bs-note${notice.tone === "danger" ? " bs-note--danger" : ""}`}
          role={notice.tone === "danger" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="bs-field-row">
        <button
          type="submit"
          className="bs-btn bs-btn--sm bs-btn-primary"
          disabled={saving || !changed}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

type Notice = { tone: "saved" | "danger"; text: string; list?: string[] };

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div
      className={`bs-note${notice.tone === "danger" ? " bs-note--danger" : ""}`}
      role={notice.tone === "danger" ? "alert" : "status"}
    >
      {notice.text}
      {notice.list && notice.list.length > 0 ? (
        <ul className="account-blockers">
          {notice.list.map((item) => (
            <li key={item}>
              <a href={`/${item}`}>{item}</a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function refusalNotice(err: unknown, fallback: string): Notice {
  return {
    tone: "danger",
    text: errorMessage(err, fallback),
    list: err instanceof AccountChangeRefused ? err.blockers : undefined,
  };
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function save() {
    if (next !== again) {
      setNotice({ tone: "danger", text: "The new passwords do not match." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      setNotice({
        tone: "saved",
        text: "Password changed. Every other device you were signed in on has been signed out.",
      });
    } catch (err) {
      setNotice(refusalNotice(err, "Your password could not be changed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bs-section" aria-label="Password">
      <h3 className="bs-section-title">Password</h3>
      <form
        className="bs-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="account-current-password">
            Current password
          </label>
          <input
            className="bs-input bs-input--sm"
            id="account-current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            disabled={saving}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="app-field-pair">
          <div className="bs-field">
            <label className="bs-field-label" htmlFor="account-new-password">
              New password
            </label>
            <input
              className="bs-input bs-input--sm"
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              disabled={saving}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className="bs-field">
            <label className="bs-field-label" htmlFor="account-again-password">
              New password again
            </label>
            <input
              className="bs-input bs-input--sm"
              id="account-again-password"
              type="password"
              autoComplete="new-password"
              value={again}
              disabled={saving}
              onChange={(event) => setAgain(event.target.value)}
            />
          </div>
        </div>
        <NoticeLine notice={notice} />
        <div className="bs-field-row">
          <button
            type="submit"
            className="bs-btn bs-btn--sm bs-btn-primary"
            disabled={saving || current === "" || next === "" || again === ""}
          >
            {saving ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Why an action is unavailable, and the things to go and fix. */
type Blocked = { reason: string; list: string[] } | null;

function UsernameForm({
  user,
  onSaved,
  blocked,
}: {
  user: SessionUser | null;
  onSaved: () => void | Promise<unknown>;
  blocked: Blocked;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const renamed = await changeUsername(name, password);
      await onSaved();
      setName("");
      setPassword("");
      setNotice({
        tone: "saved",
        text: `You sign in as ${renamed.username} now. Your drafts moved with you.`,
      });
    } catch (err) {
      setNotice(refusalNotice(err, "Your username could not be changed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bs-section" aria-label="Username">
      <h3 className="bs-section-title">Username</h3>
      <form
        className="bs-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="account-new-username">
            New username
          </label>
          <input
            className="bs-input bs-input--sm"
            id="account-new-username"
            type="text"
            autoComplete="username"
            spellCheck={false}
            placeholder={user?.username ?? ""}
            value={name}
            disabled={saving}
            aria-describedby="account-new-username-hint"
            onChange={(event) => {
              setName(event.target.value);
              setNotice(null);
            }}
          />
          {/* What a rename touches that somebody would ask about. */}
          <p className="bs-field-hint" id="account-new-username-hint">
            Your name on approvals does not change. Versions already published
            keep the username they were signed with, beside your name.
          </p>
        </div>
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="account-username-password">
            Current password
          </label>
          <input
            className="bs-input bs-input--sm"
            id="account-username-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={saving}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <NoticeLine
          notice={
            notice ??
            (blocked
              ? { tone: "danger", text: blocked.reason, list: blocked.list }
              : null)
          }
        />
        <div className="bs-field-row">
          <button
            type="submit"
            className="bs-btn bs-btn--sm bs-btn-primary"
            disabled={
              blocked !== null ||
              saving ||
              name.trim() === "" ||
              password === ""
            }
          >
            {saving ? "Changing…" : "Change username"}
          </button>
        </div>
      </form>
    </section>
  );
}

function DeleteAccountForm({
  user,
  onDeleted,
  blocked,
}: {
  user: SessionUser | null;
  onDeleted: () => void | Promise<unknown>;
  blocked: Blocked;
}) {
  const username = user?.username ?? "";
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const confirmed = confirm.trim().toLowerCase() === username.toLowerCase();

  async function remove() {
    setDeleting(true);
    setNotice(null);
    try {
      await deleteAccount(password, confirm.trim());
      await onDeleted();
    } catch (err) {
      setNotice(refusalNotice(err, "Your account could not be deleted."));
      setDeleting(false);
    }
  }

  return (
    <form
      className="bs-fields"
      onSubmit={(event) => {
        event.preventDefault();
        void remove();
      }}
    >
      {/* The two questions somebody asks before pressing it: what goes, and
          what stays. Said before the button, not after. */}
      <p className="bs-section-note">
        You leave every organization you are in, your drafts are set aside, and
        you can no longer sign in. Your approvals, comments and published
        versions stay, because they are the organization&rsquo;s record. If you
        are the only owner of an organization, make someone else an owner or
        delete it first.
      </p>
      <div className="bs-field">
        <label className="bs-field-label" htmlFor="account-delete-confirm">
          Type <strong>{username}</strong> to confirm
        </label>
        <input
          className="bs-input bs-input--sm"
          id="account-delete-confirm"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          disabled={deleting}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </div>
      <div className="bs-field">
        <label className="bs-field-label" htmlFor="account-delete-password">
          Current password
        </label>
        <input
          className="bs-input bs-input--sm"
          id="account-delete-password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={deleting}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <NoticeLine
        notice={
          notice ??
          (blocked
            ? { tone: "danger", text: blocked.reason, list: blocked.list }
            : null)
        }
      />
      <div className="bs-field-row">
        <button
          type="submit"
          className="bs-btn bs-btn--sm bs-btn--danger"
          disabled={
            blocked !== null || deleting || !confirmed || password === ""
          }
        >
          {deleting ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </form>
  );
}
