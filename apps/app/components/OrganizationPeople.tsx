import { useEffect, useState } from "react";

import {
  addOrganizationGroupMember,
  createOrganizationGroup,
  fetchOrganizationPeople,
  removeOrganizationGroupMember,
} from "../api";
import type { OrganizationPeoplePayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  GROUP_LEVELS,
  describeTeamAccess,
  groupLevelLabel,
} from "../binderSettings";
import {
  describeGroupName,
  slugifyGroupName,
} from "../../../packages/utils/groupName";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Who is in the organization, and the groups it has.
 *
 * Two org-level rungs and only two — owner and member — because every third
 * role anyone proposes turns out to be a binder role wearing a costume, and a
 * rung above the binder is the expensive kind: org-wide, invisible from the
 * binder it affects, and not something Gitea will enforce for us.
 *
 * The groups are the other half, and this is where they are made. **The
 * organization owner controls the vocabulary of groups; the binder admin
 * composes them onto their binder.** A binder admin cannot create a group,
 * change its level, or change who is in it, so the worst they can do is adopt
 * an existing group onto a binder they already run — delegation without
 * escalation, enforced by Gitea rather than checked by us.
 */

interface OrganizationPeopleProps {
  org: string;
}

export function OrganizationPeople({ org }: OrganizationPeopleProps) {
  const [payload, setPayload] = useState<OrganizationPeoplePayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);

    fetchOrganizationPeople(org)
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read this organization's people.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org]);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  if (payload === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label={`Reading who is in ${org}`}>
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">
          People
          <span className="doc-tab-count">{payload.people.length}</span>
        </h2>

        <div className="docs-list">
          {payload.people.map((person) => (
            <div className="org-person" key={person.login}>
              <PersonAvatar person={person} size="md" />
              <span className="org-person-body">
                <span className="docs-list-item-name">
                  {person.fullName || person.login}
                </span>
                <span className="docs-list-item-meta">
                  {/* The groups are where their binder access comes from, so a
                      person with none is worth saying rather than leaving
                      blank — it is the answer to "why can they not see it". */}
                  {person.teams.length > 0
                    ? person.teams.map(describeGroupName).join(" · ")
                    : "In no group yet"}
                </span>
              </span>
              <span className="doc-rail-row-note">
                {person.isOwner ? "Owner" : "Member"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <OrganizationGroups
        org={org}
        payload={payload}
        onChanged={setPayload}
        onError={setError}
      />

      {payload.canManage ? null : (
        <p className="doc-rail-note">
          Only an organization owner can create groups or change who is in them.
        </p>
      )}
    </div>
  );
}

/**
 * The groups, and the two acts that keep them true: naming one, and saying who
 * is in it.
 *
 * Changing a group's membership is one Gitea call and takes effect
 * immediately — **no commit, no approval**, and that is the point. Who is in a
 * group is a personnel fact, not a policy decision. The alternative, naming
 * people in a file on a protected branch, makes every joiner and leaver a
 * change that has to be approved by the very people the file is being edited to
 * change: a departing employee stays a required approver until somebody
 * approves their removal.
 */
function OrganizationGroups({
  org,
  payload,
  onChanged,
  onError,
}: {
  org: string;
  payload: OrganizationPeoplePayload;
  onChanged: (next: OrganizationPeoplePayload) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(act: () => Promise<OrganizationPeoplePayload>) {
    setBusy(true);
    setNotice(null);
    try {
      onChanged(await act());
      onError(null);
    } catch (err: unknown) {
      // On the section rather than the page: the list the reader is looking at
      // is still true, and replacing it with an error would hide it.
      setNotice(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="binder-settings-section">
      <h2 className="doc-rail-title">
        Groups
        <span className="doc-tab-count">{payload.groups.length}</span>
      </h2>

      {/* The constraint stated once, at the top, rather than discovered on a
          binder that refuses. A Gitea team carries one unit map, so the level
          belongs to the group and not to the grant. */}
      <p className="doc-rail-note">
        A group is a set of people and one level, used across every binder it is
        added to. The level belongs to the group, so a group cannot be an editor
        in one binder and a reviewer in another — that is two groups.
      </p>

      {notice ? <p className="app-inline-error">{notice}</p> : null}

      {payload.groups.length === 0 ? (
        <p style={{ color: "var(--bs-text-muted)" }}>
          No groups, or your access does not let you see them — Gitea shows an
          organization&rsquo;s teams to its owners.
        </p>
      ) : (
        <div className="docs-list">
          {payload.groups.map((group) => {
            const expanded = open === group.name;
            return (
              <div className="org-group" key={group.id}>
                <button
                  type="button"
                  className="org-group-head"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : group.name)}
                >
                  <span className="org-person-body">
                    <span className="docs-list-item-name">
                      {describeGroupName(group.name)}
                      <span className="org-group-level">
                        {groupLevelLabel(group.access)}
                      </span>
                    </span>
                    <span className="docs-list-item-meta">
                      {group.memberCount === 1
                        ? "1 person"
                        : `${group.memberCount} people`}
                      {group.description ? ` · ${group.description}` : ""}
                    </span>
                  </span>
                  {/* The seat consequence, on the row that decides it. */}
                  <span className="doc-rail-row-note">
                    {describeTeamAccess(group.access)}
                  </span>
                </button>

                {expanded ? (
                  <GroupMembers
                    group={group}
                    people={payload.people}
                    canManage={payload.canManage}
                    busy={busy}
                    onAdd={(username) =>
                      run(() =>
                        addOrganizationGroupMember(org, group.name, username),
                      )
                    }
                    onRemove={(username) =>
                      run(() =>
                        removeOrganizationGroupMember(
                          org,
                          group.name,
                          username,
                        ),
                      )
                    }
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {payload.canManage ? (
        <NewGroupForm
          org={org}
          busy={busy}
          existing={payload.groups.map((group) => group.name)}
          onCreated={async () => {
            onChanged(await fetchOrganizationPeople(org));
          }}
          onFailed={setNotice}
        />
      ) : null}
    </section>
  );
}

/** Who is in one group, and — for an owner — the two ways to change that. */
function GroupMembers({
  group,
  people,
  canManage,
  busy,
  onAdd,
  onRemove,
}: {
  group: OrganizationPeoplePayload["groups"][number];
  people: OrganizationPeoplePayload["people"];
  canManage: boolean;
  busy: boolean;
  onAdd: (username: string) => void;
  onRemove: (username: string) => void;
}) {
  const [adding, setAdding] = useState("");

  const inGroup = new Set(
    group.members.map((member) => member.login.toLowerCase()),
  );
  const candidates = people.filter(
    (person) => !inGroup.has(person.login.toLowerCase()),
  );

  return (
    <div className="org-group-body">
      {group.members.length === 0 ? (
        <p className="doc-rail-note">Nobody in it yet.</p>
      ) : (
        <div className="binder-team-members">
          {group.members.map((member) => (
            <span className="binder-team-member" key={member.login}>
              <PersonAvatar person={member} size="sm" />
              {member.fullName || member.login}
              {canManage ? (
                <button
                  type="button"
                  className="org-group-remove"
                  disabled={busy}
                  aria-label={`Remove ${member.fullName || member.login} from ${describeGroupName(group.name)}`}
                  onClick={() => onRemove(member.login)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="org-group-add">
          <select
            className="bs-input org-group-select"
            value={adding}
            disabled={busy || candidates.length === 0}
            onChange={(event) => setAdding(event.target.value)}
            aria-label={`Add somebody to ${describeGroupName(group.name)}`}
          >
            <option value="">
              {candidates.length === 0
                ? "Everybody here is already in it"
                : "Add somebody…"}
            </option>
            {candidates.map((person) => (
              <option key={person.login} value={person.login}>
                {person.fullName || person.login}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            disabled={busy || adding === ""}
            onClick={() => {
              onAdd(adding);
              setAdding("");
            }}
          >
            Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Naming a group and levelling it, which is one act.
 *
 * The handle is shown as it is typed rather than after the fact: a group's name
 * is written into `.gitea/CODEOWNERS` as `@org/group` when it signs off on a
 * folder, and Gitea parses that by splitting on whitespace — so the name Gitea
 * stores cannot hold a space. Showing the answer before the button is pressed
 * is cheaper than explaining it afterwards.
 */
function NewGroupForm({
  org,
  busy,
  existing,
  onCreated,
  onFailed,
}: {
  org: string;
  busy: boolean;
  existing: string[];
  onCreated: () => Promise<void>;
  onFailed: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState<string>("reviewer");
  const [saving, setSaving] = useState(false);

  const handle = slugifyGroupName(name);
  const taken = existing.some(
    (group) => group.toLowerCase() === handle.toLowerCase(),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (handle === "" || taken) return;

    setSaving(true);
    try {
      await createOrganizationGroup(org, name, level);
      setName("");
      setLevel("reviewer");
      await onCreated();
    } catch (err: unknown) {
      onFailed(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to create the group.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="org-group-form" onSubmit={submit}>
      <h3 className="doc-rail-title">New group</h3>

      <label className="create-document-field">
        <span className="bs-label">Name</span>
        <input
          className="bs-input org-group-select"
          value={name}
          placeholder="Quality Committee"
          disabled={busy || saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {handle === "" ? null : (
        <p className="doc-rail-note">
          {taken ? (
            <>
              {org} already has a group called <code>{handle}</code>.
            </>
          ) : (
            <>
              It will be called <code>{handle}</code>.
            </>
          )}
        </p>
      )}

      <fieldset className="org-group-levels">
        <legend className="bs-label">Level</legend>
        {GROUP_LEVELS.map((option) => (
          <label className="org-group-level-option" key={option.value}>
            <input
              type="radio"
              name="group-level"
              value={option.value}
              checked={level === option.value}
              disabled={busy || saving}
              onChange={() => setLevel(option.value)}
            />
            <span>
              <span className="docs-list-item-name">{option.label}</span>
              <span className="docs-list-item-meta">{option.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="bs-btn bs-btn-primary"
        disabled={busy || saving || handle === "" || taken}
      >
        {saving ? "Creating…" : "Create group"}
      </button>

      {/* Said here because it is the question somebody asks next, and the
          answer is a reassurance: naming a group gives nobody access. */}
      <p className="doc-rail-note">
        A new group reaches no binder until somebody who runs that binder adds
        it.
      </p>
    </form>
  );
}
