import { useEffect, useState } from "react";

import {
  addOrganizationGroupMember,
  createOrganizationGroup,
  fetchOrganizationPeople,
  grantBinderGroup,
  removeOrganizationGroupMember,
  removeOrganizationPerson,
  revokeBinderGroup,
  setOrganizationPersonRole,
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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const ownerCount = payload.people.filter((person) => person.isOwner).length;

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">
          People
          <span className="doc-tab-count">{payload.people.length}</span>
        </h2>

        {notice ? <p className="app-inline-error">{notice}</p> : null}

        <div className="docs-list">
          {payload.people.map((person) => (
            <OrgPersonRow
              key={person.login}
              org={org}
              person={person}
              // The last owner cannot be demoted or removed, and the control
              // says so in place of a tooltip rather than failing when pressed.
              lastOwner={person.isOwner && ownerCount === 1}
              isViewer={
                person.login.toLowerCase() === payload.viewer.toLowerCase()
              }
              canManage={payload.canManage}
              busy={busy}
              onChanged={setPayload}
              onFailed={setNotice}
              onBusy={setBusy}
            />
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
          Only an organization owner can add and remove people, create groups,
          or change who is in them.
        </p>
      )}
    </div>
  );
}

/**
 * One person in the organization, and the two acts an owner has on them.
 *
 * The role is a dropdown; **promoting gets a confirmation** because it is the
 * one change that hands over the keys, and removal gets one because it is the
 * one that cannot be undone by pressing the same control again.
 *
 * The removal copy is the important string on this page. The fear behind "can I
 * remove someone" in a regulated industry is that the record leaves with them —
 * it is the fifth thing ADR 0004 lists as broken about the old model — and the
 * moment of removal is the moment to answer it. Answering it turns an
 * administrative chore into a demonstration of the thing they are paying for.
 */
function OrgPersonRow({
  org,
  person,
  lastOwner,
  isViewer,
  canManage,
  busy,
  onChanged,
  onFailed,
  onBusy,
}: {
  org: string;
  person: OrganizationPeoplePayload["people"][number];
  lastOwner: boolean;
  isViewer: boolean;
  canManage: boolean;
  busy: boolean;
  onChanged: (next: OrganizationPeoplePayload) => void;
  onFailed: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [confirming, setConfirming] = useState<"promote" | "remove" | null>(
    null,
  );

  const name = person.fullName || person.login;

  async function run(act: () => Promise<OrganizationPeoplePayload>) {
    onBusy(true);
    onFailed(null);
    try {
      onChanged(await act());
      setConfirming(null);
    } catch (err: unknown) {
      onFailed(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "That did not work.",
      );
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="org-person-block">
      <div className="org-person">
        <PersonAvatar person={person} size="md" />
        <span className="org-person-body">
          <span className="docs-list-item-name">{name}</span>
          <span className="docs-list-item-meta">
            {/* The groups are where their binder access comes from, so a person
                with none is worth saying rather than leaving blank — it is the
                answer to "why can they not see it". */}
            {person.teams.length > 0
              ? person.teams.map(describeGroupName).join(" · ")
              : "In no group yet"}
          </span>
        </span>

        {canManage ? (
          <select
            className="bs-input binder-role-select"
            value={person.isOwner ? "owner" : "member"}
            disabled={busy || lastOwner}
            aria-label={`What ${name} can do in ${org}`}
            onChange={(event) => {
              if (event.target.value === "owner") {
                setConfirming("promote");
              } else {
                void run(() =>
                  setOrganizationPersonRole(org, person.login, false),
                );
              }
            }}
          >
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
        ) : (
          <span className="doc-rail-row-note">
            {person.isOwner ? "Owner" : "Member"}
          </span>
        )}

        {/* Not on your own row. Leaving an organization is a different act from
            removing somebody else, and offering it here as "Remove Alice" reads
            like an accident waiting to happen. */}
        {canManage && !isViewer && !lastOwner ? (
          <button
            type="button"
            className="org-group-remove"
            disabled={busy}
            aria-label={`Remove ${name} from ${org}`}
            onClick={() => setConfirming("remove")}
          >
            ×
          </button>
        ) : null}
      </div>

      {/* In place of a tooltip, which nobody reads and no keyboard reaches. */}
      {canManage && lastOwner ? (
        <p className="doc-rail-note org-person-reason">
          {org} needs at least one owner. Make someone else an owner first.
        </p>
      ) : null}

      {confirming === "promote" ? (
        <div className="org-person-confirm">
          <p className="docs-list-item-name">Make {name} an owner?</p>
          <p className="docs-list-item-meta">
            Owners can add and remove anyone, create and delete binders, and
            manage billing.
          </p>
          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary bs-btn--sm"
              disabled={busy}
              onClick={() =>
                run(() => setOrganizationPersonRole(org, person.login, true))
              }
            >
              Make {name} an owner
            </button>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirming === "remove" ? (
        <div className="org-person-confirm">
          <p className="docs-list-item-name">
            Remove {name} from {org}?
          </p>
          <p className="docs-list-item-meta">
            They lose access immediately, everywhere.
          </p>
          {/* The sentence this page exists to be able to say. */}
          <p className="docs-list-item-meta">
            Everything they wrote, approved or commented on stays exactly where
            it is — that record is yours, not theirs.
          </p>
          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn--danger bs-btn--sm"
              disabled={busy}
              onClick={() =>
                run(() => removeOrganizationPerson(org, person.login))
              }
            >
              Remove {name}
            </button>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * How far a group reaches, said on the collapsed row.
 *
 * A group that is in no binder grants nothing anywhere, and that is worth
 * saying rather than leaving somebody to open the row and find out — it is the
 * difference between a group that has been set up and one that has only been
 * named.
 */
function describeGroupReach(group: {
  name: string;
  binders: string[];
}): string {
  if (isOwnersGroup(group)) return "every binder";
  if (group.binders.length === 0) return "in no binder";
  if (group.binders.length === 1) return `in ${group.binders[0]}`;
  return `in ${group.binders.length} binders`;
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
                      {` · ${describeGroupReach(group)}`}
                      {group.description ? ` · ${group.description}` : ""}
                    </span>
                  </span>
                  {/* The seat consequence, on the row that decides it. */}
                  <span className="doc-rail-row-note">
                    {describeTeamAccess(group.access)}
                  </span>
                </button>

                {expanded ? (
                  <GroupDetail
                    group={group}
                    people={payload.people}
                    binders={payload.binders}
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
                    onAddBinder={(binder) =>
                      run(async () => {
                        await grantBinderGroup(org, binder, group.name);
                        // The grant answers with the *binder's* teams, and this
                        // page is about the organization. Reading it back is
                        // what keeps the group's binder list and the whitelist
                        // that grant just rewrote from being two stories.
                        return fetchOrganizationPeople(org);
                      })
                    }
                    onRemoveBinder={(binder) =>
                      run(async () => {
                        await revokeBinderGroup(org, binder, group.name);
                        return fetchOrganizationPeople(org);
                      })
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

/**
 * Gitea's built-in Owners team, which reaches every binder in the organization
 * implicitly rather than by a grant.
 *
 * Its binder list is complete and cannot be edited — adding is offering
 * something already true, removing is offering something that cannot happen —
 * so the row says that instead of drawing two controls the API refuses.
 */
function isOwnersGroup(group: { name: string }): boolean {
  return group.name === "Owners";
}

/**
 * One group opened up: who is in it, and which binders it reaches.
 *
 * Both lists are the group seen from the two ends it matters at, and the second
 * is the one this page was missing. A binder's Settings tab answers "who can
 * act here"; an owner looking at a group is asking the opposite question, and
 * it is the question that decides whether changing the group is safe — a level
 * or a membership change lands on every binder in this list at once.
 */
function GroupDetail({
  group,
  people,
  binders,
  canManage,
  busy,
  onAdd,
  onRemove,
  onAddBinder,
  onRemoveBinder,
}: {
  group: OrganizationPeoplePayload["groups"][number];
  people: OrganizationPeoplePayload["people"];
  binders: string[];
  canManage: boolean;
  busy: boolean;
  onAdd: (username: string) => void;
  onRemove: (username: string) => void;
  onAddBinder: (binder: string) => void;
  onRemoveBinder: (binder: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const [addingBinder, setAddingBinder] = useState("");

  const inGroup = new Set(
    group.members.map((member) => member.login.toLowerCase()),
  );
  const candidates = people.filter(
    (person) => !inGroup.has(person.login.toLowerCase()),
  );

  const reaches = new Set(group.binders.map((binder) => binder.toLowerCase()));
  const binderCandidates = binders.filter(
    (binder) => !reaches.has(binder.toLowerCase()),
  );

  const owners = isOwnersGroup(group);

  return (
    <div className="org-group-body">
      <div className="org-group-part">
        <h4 className="bs-label">People</h4>
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

      <div className="org-group-part">
        <h4 className="bs-label">Binders</h4>

        {owners ? (
          // Not a grant, so not something to add to or take away from: Gitea
          // gives this team admin over the whole organization, which covers
          // binders that do not exist yet.
          <p className="doc-rail-note">
            Owners administer every binder in this organization, including ones
            made later. That is not a grant and cannot be changed here.
          </p>
        ) : group.binders.length === 0 ? (
          <p className="doc-rail-note">
            In no binder yet, so it grants nothing anywhere. Naming a group is
            free — this is where it starts to mean something.
          </p>
        ) : (
          <div className="binder-team-members">
            {group.binders.map((binder) => (
              <span className="org-group-binder" key={binder}>
                {binder}
                {canManage ? (
                  <button
                    type="button"
                    className="org-group-remove"
                    disabled={busy}
                    aria-label={`Take ${describeGroupName(group.name)} off ${binder}`}
                    onClick={() => onRemoveBinder(binder)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}

        {canManage && !owners ? (
          <div className="org-group-add">
            <select
              className="bs-input org-group-select"
              value={addingBinder}
              disabled={busy || binderCandidates.length === 0}
              onChange={(event) => setAddingBinder(event.target.value)}
              aria-label={`Add ${describeGroupName(group.name)} to a binder`}
            >
              <option value="">
                {binderCandidates.length === 0
                  ? "It is already in every binder"
                  : "Add to a binder…"}
              </option>
              {binderCandidates.map((binder) => (
                <option key={binder} value={binder}>
                  {binder}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              disabled={busy || addingBinder === ""}
              onClick={() => {
                onAddBinder(addingBinder);
                setAddingBinder("");
              }}
            >
              Add
            </button>
          </div>
        ) : null}

        {/* The level is not repeated per binder on purpose. It is the group's,
            not the grant's, so saying it once here is saying it for all of
            them — and saying it per row would imply it could differ. */}
        {group.binders.length > 1 && !owners ? (
          <p className="doc-rail-note">
            This group is {groupLevelLabel(group.access).toLowerCase()} in all{" "}
            {group.binders.length} of them. Changing its level or its people
            changes all {group.binders.length} at once.
          </p>
        ) : null}
      </div>
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
