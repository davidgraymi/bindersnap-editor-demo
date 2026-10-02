import { useState } from "react";

import { updateProfile } from "../api";
import type { SessionUser } from "../../../packages/api-schema/schemas/auth";
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
}: {
  user: SessionUser | null;
  /** Read the session again, so every screen that names them catches up. */
  onUserChanged: () => void | Promise<unknown>;
}) {
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
