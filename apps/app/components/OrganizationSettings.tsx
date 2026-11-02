import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  deleteOrganization,
  fetchOrganizationDeletion,
  updateOrganizationSettings,
} from "../api";
import { organizationSettingsQuery, queryKeys } from "../data/queries";
import type {
  NewBinderDefaults,
  OrganizationDeletion,
  OrganizationSettingsPayload,
} from "../../../packages/api-schema/schemas/organizations";
import { ApprovalCountField } from "./BinderSettings";
import { SettingsGroup } from "./SettingsGroup";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

/**
 * The organization's own settings: `/{org}/-/settings`.
 *
 * Three questions, in the order somebody arrives with them: what it is called
 * and what it is for; what a new binder in it starts with; and, last and
 * heaviest, deleting it. Gitea's rules decide who may delete and when — an
 * owner, once no binder is left in it — and the page says which of those is
 * not yet true before anybody types anything.
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
      <OrganizationGeneral org={org} />

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

/**
 * What the organization is called and what it is for, and what a new binder
 * in it starts with.
 *
 * Read by everybody in it, changed by its owners. The name is the one every
 * page shows; the address in its links stays as it is.
 */
function OrganizationGeneral({ org }: { org: string }) {
  const read = useQuery(organizationSettingsQuery(org));
  const queryClient = useQueryClient();

  const saved = (next: OrganizationSettingsPayload) => {
    queryClient.setQueryData(queryKeys.organizationSettings(org), next);
    // Every page that names the organization reads the list it is in.
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
  };

  if (read.error) {
    return (
      <p className="bs-note bs-note--danger" role="alert">
        {read.error.message || "Unable to read this organization's settings."}
      </p>
    );
  }
  if (!read.data) {
    return (
      <SkeletonGroup label="Reading this organization's settings">
        <SkeletonLine width="medium" />
        <SkeletonLine width="short" />
      </SkeletonGroup>
    );
  }

  const settings = read.data;
  return (
    <>
      {settings.canManage ? null : (
        <p className="bs-section-note">
          Only an owner of {settings.organization.displayName} can change these
          settings.
        </p>
      )}
      <NameAndDescription org={org} settings={settings} onSaved={saved} />
      <NewBinderRules org={org} settings={settings} onSaved={saved} />
    </>
  );
}

function NameAndDescription({
  org,
  settings,
  onSaved,
}: {
  org: string;
  settings: OrganizationSettingsPayload;
  onSaved: (next: OrganizationSettingsPayload) => void;
}) {
  const [name, setName] = useState(settings.organization.displayName);
  const [about, setAbout] = useState(settings.organization.description);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nameChanged = name.trim() !== settings.organization.displayName;
  const aboutChanged = about.trim() !== settings.organization.description;
  const canManage = settings.canManage;

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      onSaved(
        await updateOrganizationSettings(org, {
          ...(nameChanged ? { displayName: name.trim() } : {}),
          ...(aboutChanged ? { description: about.trim() } : {}),
        }),
      );
    } catch (err) {
      setNotice(errorMessage(err, "Unable to save the organization's name."));
    }
    setSaving(false);
  }

  return (
    <SettingsGroup
      id="org-settings-general"
      title="Name and description"
      note="What every page calls it, and a sentence about what it is for."
    >
      <form
        className="bs-fields"
        onSubmit={(event) => {
          event.preventDefault();
          if (canManage) void save();
        }}
      >
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="org-settings-name">
            Name
          </label>
          <input
            className="bs-input bs-input--sm"
            id="org-settings-name"
            type="text"
            value={name}
            maxLength={100}
            disabled={saving || !canManage}
            aria-describedby="org-settings-name-hint"
            onChange={(event) => {
              setName(event.target.value);
              setNotice(null);
            }}
          />
          {/* Gitea keeps the two apart, and so does this: the name is what
              every page says, the address is every link to it. */}
          <p className="bs-field-hint" id="org-settings-name-hint">
            Its address stays <strong>/{settings.organization.name}</strong>, so
            links to it keep working.
          </p>
        </div>
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="org-settings-description">
            Description
            <span className="bs-field-optional">optional</span>
          </label>
          <textarea
            className="bs-input bs-input--sm bs-settings-description"
            id="org-settings-description"
            value={about}
            maxLength={255}
            rows={2}
            disabled={saving || !canManage}
            onChange={(event) => {
              setAbout(event.target.value);
              setNotice(null);
            }}
          />
        </div>
        {notice ? (
          <p className="bs-note bs-note--danger" role="alert">
            {notice}
          </p>
        ) : null}
        {canManage ? (
          <div className="bs-field-row">
            <button
              type="submit"
              className="bs-btn bs-btn--sm bs-btn-primary"
              disabled={
                saving || name.trim() === "" || (!nameChanged && !aboutChanged)
              }
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </form>
    </SettingsGroup>
  );
}

/**
 * What a new binder starts with.
 *
 * **Defaults, not rules.** Each is written onto a binder when it is made, and
 * from then on is that binder's own, changed in its own settings. Changing a
 * default changes no binder that already exists — the page says so, because
 * somebody raising the count here would otherwise expect every binder to
 * follow. Saved as each is changed, as a binder's own rules are.
 */
function NewBinderRules({
  org,
  settings,
  onSaved,
}: {
  org: string;
  settings: OrganizationSettingsPayload;
  onSaved: (next: OrganizationSettingsPayload) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rules = settings.newBinders;
  const canManage = settings.canManage;

  async function change(next: Partial<NewBinderDefaults>) {
    setSaving(true);
    setNotice(null);
    try {
      onSaved(await updateOrganizationSettings(org, { newBinders: next }));
    } catch (err) {
      setNotice(errorMessage(err, "Unable to save that default."));
    }
    setSaving(false);
  }

  const yesNo = (value: boolean) => (value ? "Yes" : "No");

  return (
    <SettingsGroup
      id="org-settings-new-binders"
      title="New binders"
      note={`What a new binder in ${settings.organization.displayName} starts with. Each binder's administrator can change its own afterwards, and changing these changes no binder that already exists.`}
    >
      <div className="bs-panel">
        <ul className="bs-row-list">
          <li className="bs-row">
            <span className="bs-row-body">
              <label className="bs-row-name" htmlFor="org-new-binder-approvals">
                Approvals required
              </label>
              <span className="bs-row-meta">
                {rules.requiredApprovals === 0
                  ? "A new binder publishes without an approval until its administrator names approvers."
                  : "Whoever makes a binder chooses its approvers, on the same form."}
              </span>
            </span>
            <span className="bs-row-right bs-settings-value">
              {canManage ? (
                <ApprovalCountField
                  id="org-new-binder-approvals"
                  label="Approvals required for a new binder"
                  value={rules.requiredApprovals}
                  disabled={saving}
                  onCommit={(count) =>
                    void change({ requiredApprovals: count })
                  }
                />
              ) : (
                rules.requiredApprovals
              )}
            </span>
          </li>
          <li className="bs-row">
            <span className="bs-row-body">
              <label
                className="bs-row-name"
                htmlFor="org-new-binder-dismiss-stale"
              >
                Ask approvers again after the change is edited
              </label>
            </span>
            <span className="bs-row-right bs-settings-value">
              {canManage ? (
                <input
                  id="org-new-binder-dismiss-stale"
                  className="bs-checkbox"
                  type="checkbox"
                  checked={rules.dismissStaleApprovals}
                  disabled={saving}
                  onChange={(event) =>
                    void change({ dismissStaleApprovals: event.target.checked })
                  }
                />
              ) : (
                yesNo(rules.dismissStaleApprovals)
              )}
            </span>
          </li>
          <li className="bs-row">
            <span className="bs-row-body">
              <label className="bs-row-name" htmlFor="org-new-binder-threads">
                Every discussion must be resolved
              </label>
            </span>
            <span className="bs-row-right bs-settings-value">
              {canManage ? (
                <input
                  id="org-new-binder-threads"
                  className="bs-checkbox"
                  type="checkbox"
                  checked={rules.blockOnUnresolvedThreads}
                  disabled={saving}
                  onChange={(event) =>
                    void change({
                      blockOnUnresolvedThreads: event.target.checked,
                    })
                  }
                />
              ) : (
                yesNo(rules.blockOnUnresolvedThreads)
              )}
            </span>
          </li>
        </ul>
      </div>
      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}
    </SettingsGroup>
  );
}
