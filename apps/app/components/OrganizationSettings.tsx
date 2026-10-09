import { useEffect, useState } from "react";

import { deleteOrganization, fetchOrganizationDeletion } from "../api";
import type { OrganizationDeletion } from "../../../packages/api-schema/schemas/organizations";
import { SettingsGroup } from "./SettingsGroup";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

/**
 * The organization's own settings: `/{org}/-/settings`.
 *
 * One question here so far, and the heaviest: deleting it. Gitea's rules decide
 * who may and when — an owner, once no binder is left in it — and the page
 * says which of those is not yet true before anybody types anything.
 */
export function OrganizationSettings({
  org,
  displayName,
}: {
  org: string;
  displayName: string;
}) {
  const [deletion, setDeletion] = useState<OrganizationDeletion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOrganizationDeletion(org)
      .then((next) => {
        if (!cancelled) setDeletion(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Unable to read this."));
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  return (
    <div className="bs-settings org-settings">
      <SettingsGroup
        id="org-settings-delete"
        title="Delete this organization"
        note="Permanent. Its people and groups go with it."
      >
        {error ? (
          <p className="bs-note bs-note--danger" role="alert">
            {error}
          </p>
        ) : deletion === null ? null : !deletion.isOwner ? (
          <p className="bs-section-note">
            Only an owner of {displayName} can delete it.
          </p>
        ) : (
          <DeleteOrganization
            org={org}
            displayName={displayName}
            deletion={deletion}
          />
        )}
      </SettingsGroup>
    </div>
  );
}

function DeleteOrganization({
  org,
  displayName,
  deletion,
}: {
  org: string;
  displayName: string;
  deletion: OrganizationDeletion;
}) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmed = confirm.trim().toLowerCase() === org.toLowerCase();

  // What is in the way, said first: a form that can only fail is not offered.
  if (deletion.binders.length > 0 || deletion.billingActive) {
    return (
      <div className="bs-section-note">
        <p>Before {displayName} can be deleted:</p>
        <ul className="account-blockers">
          {deletion.binders.length > 0 ? (
            <li>
              Delete every binder in it, from each binder&rsquo;s Settings:{" "}
              {deletion.binders.map((binder, index) => (
                <span key={binder}>
                  {index > 0 ? ", " : ""}
                  <a href={`/${org}/${binder}/-/settings`}>{binder}</a>
                </span>
              ))}
              .
            </li>
          ) : null}
          {deletion.billingActive ? (
            <li>
              Cancel its subscription in{" "}
              <a href={`/${org}/-/billing`}>Billing</a>.
            </li>
          ) : null}
        </ul>
      </div>
    );
  }

  return (
    <form
      className="bs-fields"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!confirmed) return;
        setDeleting(true);
        setNotice(null);
        try {
          await deleteOrganization(org, confirm.trim());
          // A full load of home, which starts with an empty cache and reads
          // the organizations again.
          window.location.assign("/");
        } catch (err) {
          setNotice(errorMessage(err, "Unable to delete the organization."));
          setDeleting(false);
        }
      }}
    >
      <p className="bs-section-note">
        Everyone in it loses access to it, and its groups and its address go.
        Their own accounts stay.
      </p>
      <div className="bs-field">
        <label className="bs-field-label" htmlFor="org-delete-confirm">
          Type <strong>{org}</strong> to confirm
        </label>
        <input
          className="bs-input bs-input--sm"
          id="org-delete-confirm"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={confirm}
          disabled={deleting}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </div>
      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="bs-field-row">
        <button
          type="submit"
          className="bs-btn bs-btn--sm bs-btn--danger"
          disabled={deleting || !confirmed}
        >
          {deleting ? "Deleting…" : "Delete this organization"}
        </button>
      </div>
    </form>
  );
}
