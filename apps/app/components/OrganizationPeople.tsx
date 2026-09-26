import { useEffect, useRef, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";

import {
  addOrganizationGroupMember,
  addOrganizationPerson,
  createOrganizationGroup,
  fetchOrganizationPeople,
  grantBinderGroup,
  removeOrganizationGroupMember,
  removeOrganizationPerson,
  revokeBinderGroup,
  searchWorkspaceUsers,
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
import { ChevronRight, X } from "lucide-react";

import { AppIcon } from "./AppIcon";
import { SettingsGroup } from "./SettingsGroup";
import { SkeletonPanel } from "./Skeleton";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

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
  const orgName = useOrganizationDisplayName(org);
  // Same fold as the binder's People tab: a delinquent organization draws no
  // controls, by the flag that already decides whether controls exist.
  const isReadOnly = useIsReadOnly();
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
        <SkeletonPanel label={`Reading who is in ${orgName}`} rows={4} right />
      </div>
    );
  }

  const ownerCount = payload.people.filter((person) => person.isOwner).length;

  return (
    <div className="binder-pane bs-settings">
      {/* Said first, to somebody who cannot act: the page below is theirs to
          read, and the controls are missing on purpose. */}
      {payload.canManage ? null : (
        <p className="bs-note">
          Only an organization owner can add and remove people, create groups,
          or change who is in them.
        </p>
      )}

      <SettingsGroup
        id="org-people-members"
        title="Members"
        count={payload.people.length}
        note={`Everyone in ${orgName}. An owner runs the organization; what a member can do is set binder by binder, by the groups they are in.`}
      >
        {notice ? (
          <p className="bs-note bs-note--danger" role="alert">
            {notice}
          </p>
        ) : null}

        <section className="bs-panel" aria-label={`Members of ${orgName}`}>
          <ul className="bs-row-list">
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
                canManage={payload.canManage && !isReadOnly}
                busy={busy}
                onChanged={setPayload}
                onFailed={setNotice}
                onBusy={setBusy}
              />
            ))}
          </ul>
        </section>

        {payload.canManage && !isReadOnly ? (
          <AddOrgPersonForm
            org={org}
            busy={busy}
            already={payload.people.map((person) => person.login)}
            onAdded={setPayload}
            onFailed={setNotice}
            onBusy={setBusy}
          />
        ) : null}
      </SettingsGroup>

      <OrganizationGroups
        org={org}
        payload={payload}
        onChanged={setPayload}
        onError={setError}
      />
    </div>
  );
}

/** How many of a person's groups their row names before counting the rest. */
const GROUPS_SHOWN = 3;

/**
 * "Clinical Authors · Legal and 4 more groups" — where a person's access comes
 * from, short enough to stay on one line of their row.
 */
export function describePersonGroups(teams: readonly string[]): string {
  if (teams.length === 0) return "In no group yet";
  const named = teams.slice(0, GROUPS_SHOWN).map(describeGroupName).join(" · ");
  const rest = teams.length - GROUPS_SHOWN;
  if (rest <= 0) return named;
  return `${named} and ${rest} more ${rest === 1 ? "group" : "groups"}`;
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
  const orgName = useOrganizationDisplayName(org);
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
    <li className="org-person-block">
      <div className="bs-row bs-row--tall">
        <PersonAvatar person={person} size="md" />
        <span className="bs-row-body">
          <span className="bs-row-name">{name}</span>
          {/* The groups are where their binder access comes from, so a person
              with none is worth saying rather than leaving blank — it is the
              answer to "why can they not see it". Shortened past three, with
              the whole list on hover: an owner in ten groups made their row
              three lines tall. */}
          <span
            className="bs-row-meta"
            title={
              person.teams.length > GROUPS_SHOWN
                ? person.teams.map(describeGroupName).join(", ")
                : undefined
            }
          >
            {describePersonGroups(person.teams)}
          </span>
        </span>

        <span className="bs-row-right">
          {canManage ? (
            <select
              className="bs-input bs-input--sm binder-role-select"
              value={person.isOwner ? "owner" : "member"}
              disabled={busy || lastOwner}
              aria-label={`What ${name} can do in ${orgName}`}
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
            <span>{person.isOwner ? "Owner" : "Member"}</span>
          )}

          {/* Not on your own row. Leaving an organization is a different act from
            removing somebody else, and offering it here as "Remove Alice" reads
            like an accident waiting to happen. The space is kept, so the role
            on that row lines up with every other one. */}
          {canManage ? (
            !isViewer && !lastOwner ? (
              <button
                type="button"
                className="bs-rowact bs-rowact--danger"
                disabled={busy}
                aria-label={`Remove ${name} from ${orgName}`}
                title={`Remove ${name} from ${orgName}`}
                onClick={() => setConfirming("remove")}
              >
                <AppIcon icon={X} size="sm" />
              </button>
            ) : (
              <span className="bs-rowact-slot" aria-hidden="true" />
            )
          ) : null}
        </span>
      </div>

      {/* In place of a tooltip, which nobody reads and no keyboard reaches. */}
      {canManage && lastOwner ? (
        <p className="bs-row-meta org-person-reason">
          {orgName} needs at least one owner. Make someone else an owner first.
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
            Remove {name} from {orgName}?
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
    </li>
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
  const orgName = useOrganizationDisplayName(org);
  const isReadOnly = useIsReadOnly();
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
    // The constraint stated once, at the top, rather than discovered on a
    // binder that refuses. A Gitea team carries one unit map, so the level
    // belongs to the group and not to the grant.
    <SettingsGroup
      id="org-people-groups"
      title="Groups"
      count={payload.groups.length}
      note="A group is a set of people and one level, used across every binder it is added to. The level belongs to the group, so a group cannot be an editor in one binder and a reviewer in another — that is two groups."
    >
      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}

      {payload.groups.length === 0 ? (
        <div className="bs-panel">
          <div className="bs-empty">
            <p>
              No groups, or your access does not let you see them — Gitea shows
              an organization&rsquo;s teams to its owners.
            </p>
          </div>
        </div>
      ) : (
        <section className="bs-panel" aria-label={`Groups in ${orgName}`}>
          <ul className="bs-row-list">
            {payload.groups.map((group) => {
              const expanded = open === group.name;
              return (
                <li className="org-group" key={group.id}>
                  {/* A chevron, because a row that opens has to say so before
                    it is pressed — GitLab's expandable rows do, and these
                    looked exactly like the rows above that open nothing. */}
                  <button
                    type="button"
                    className="bs-row bs-row--tall org-group-head"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : group.name)}
                  >
                    <span className="bs-row-icon org-group-chevron">
                      <ChevronRight
                        size={16}
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="bs-row-body">
                      <span className="bs-row-name">
                        {describeGroupName(group.name)}
                        <span className="org-group-level">
                          {groupLevelLabel(group.access)}
                        </span>
                      </span>
                      <span className="bs-row-meta">
                        {group.memberCount === 1
                          ? "1 person"
                          : `${group.memberCount} people`}
                        {` · ${describeGroupReach(group)}`}
                        {group.description ? ` · ${group.description}` : ""}
                      </span>
                    </span>
                    {/* The seat consequence, on the row that decides it. */}
                    <span className="bs-row-right">
                      {describeTeamAccess(group.access)}
                    </span>
                  </button>

                  {expanded ? (
                    <GroupDetail
                      group={group}
                      people={payload.people}
                      binders={payload.binders}
                      canManage={payload.canManage && !isReadOnly}
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
                </li>
              );
            })}
          </ul>
        </section>
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
    </SettingsGroup>
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
        <h4 className="bs-field-label">People</h4>
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
                    <X size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}

        {canManage ? (
          <div className="org-group-add">
            <select
              className="bs-input bs-input--sm org-group-select"
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
        <h4 className="bs-field-label">Binders</h4>

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
                    <X size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}

        {canManage && !owners ? (
          <div className="org-group-add">
            <select
              className="bs-input bs-input--sm org-group-select"
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

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_RESULT_LIMIT = 6;

/**
 * Put somebody in the organization.
 *
 * **This is where an invitation would go, and there isn't one.** Gitea cannot
 * hold a pending invitation, and this product has no way to send an email yet
 * — so the person has to have signed up already, and the form says so rather
 * than letting an owner type a colleague's address and watch nothing happen.
 * The invitations issue, 426, is the rest of that story; until it lands, the
 * honest surface is
 * a search over accounts that exist.
 *
 * Search rather than a dropdown, because the candidates are every account on
 * the instance: a `<select>` of all of them would be unusable at any real size
 * and would let one customer enumerate every other customer's people. Typing a
 * name you already know is also what the act actually is — you are adding a
 * specific colleague, not browsing.
 */
function AddOrgPersonForm({
  org,
  busy,
  already,
  onAdded,
  onFailed,
  onBusy,
}: {
  org: string;
  busy: boolean;
  /** Who is in the organization already, so they are not offered twice. */
  already: string[];
  onAdded: (payload: OrganizationPeoplePayload) => void;
  onFailed: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const orgName = useOrganizationDisplayName(org);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<
    Array<{ login: string; fullName: string }>
  >([]);
  const [picked, setPicked] = useState<{
    login: string;
    fullName: string;
  } | null>(null);
  const [owner, setOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchId = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(
      () => setDebounced(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const requestId = ++searchId.current;

    // One letter matches most of the instance and answers nothing useful.
    if (debounced.length < 2 || picked !== null) {
      setResults([]);
      return;
    }

    void (async () => {
      try {
        const payload = await searchWorkspaceUsers(
          debounced,
          1,
          SEARCH_RESULT_LIMIT,
        );
        if (requestId !== searchId.current) return;
        setResults(
          payload.users
            .map((user) => ({
              login: user.login ?? "",
              fullName: user.full_name ?? "",
            }))
            .filter((user) => user.login !== ""),
        );
      } catch {
        // A search that failed is an empty list, not an error banner: the
        // owner can still type the exact username and press Add.
        if (requestId !== searchId.current) return;
        setResults([]);
      }
    })();
  }, [debounced, picked]);

  const here = new Set(already.map((login) => login.toLowerCase()));
  const suggestions = results.filter(
    (user) => !here.has(user.login.toLowerCase()),
  );

  const username = picked?.login ?? query.trim();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (username === "") return;

    setSaving(true);
    onBusy(true);
    try {
      onAdded(await addOrganizationPerson(org, username, owner));
      setQuery("");
      setDebounced("");
      setPicked(null);
      setOwner(false);
      setResults([]);
    } catch (err: unknown) {
      // On the section rather than the page. The refusal worth reading is
      // "they have not signed up yet", and replacing the list with it would
      // hide the people it is about.
      onFailed(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to add them to the organization.",
      );
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }

  const disabled = busy || saving;

  return (
    <section className="bs-section" aria-labelledby="org-people-add">
      <div className="bs-section-head">
        <h3 className="bs-section-title" id="org-people-add">
          Add someone
        </h3>
      </div>
      <form className="bs-fields" onSubmit={submit}>
        <label className="bs-field">
          <span className="bs-field-label">Who</span>
          <input
            className="bs-input bs-input--sm"
            value={picked ? picked.fullName || picked.login : query}
            placeholder="Their username"
            disabled={disabled}
            onChange={(event) => {
              setPicked(null);
              setQuery(event.target.value);
            }}
          />
        </label>

        {picked ? (
          <p className="bs-field-hint">
            Adding <code>{picked.login}</code>.{" "}
            <button
              type="button"
              className="bs-btn bs-btn-ghost bs-btn--sm"
              disabled={disabled}
              onClick={() => {
                setPicked(null);
                setQuery("");
              }}
            >
              Change
            </button>
          </p>
        ) : suggestions.length > 0 ? (
          <div className="bs-panel">
            {suggestions.map((user) => (
              <button
                key={user.login}
                type="button"
                className="bs-row org-person-suggestion"
                disabled={disabled}
                onClick={() => {
                  setPicked(user);
                  setResults([]);
                }}
              >
                <PersonAvatar person={user} />
                <span className="bs-row-body">
                  <span className="bs-row-name">
                    {user.fullName || user.login}
                  </span>
                </span>
                <span className="bs-row-right">{user.login}</span>
              </button>
            ))}
          </div>
        ) : null}

        <fieldset className="bs-field">
          <legend className="bs-field-label">Role</legend>
          <label className="bs-choice">
            <input
              type="radio"
              name="org-add-role"
              checked={!owner}
              disabled={disabled}
              onChange={() => setOwner(false)}
            />
            <span>
              <span className="bs-choice-name">Member</span>
              <span className="bs-choice-note">
                Access is set per binder. Costs nothing until they are made an
                admin or an editor somewhere.
              </span>
            </span>
          </label>
          <label className="bs-choice">
            <input
              type="radio"
              name="org-add-role"
              checked={owner}
              disabled={disabled}
              onChange={() => setOwner(true)}
            />
            <span>
              <span className="bs-choice-name">Owner</span>
              <span className="bs-choice-note">
                Can add and remove anyone, create binders, and manage billing.
                Uses a seat.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="org-people-actions">
          <button
            type="submit"
            className="bs-btn bs-btn-primary bs-btn--sm"
            disabled={disabled || username === ""}
          >
            {saving ? "Adding…" : `Add to ${orgName}`}
          </button>
        </div>

        {/* The limitation stated on the form rather than met as a refusal. It is
          the visible edge of having no invitation flow, and somebody reaching
          for a colleague who has not signed up deserves to know before they
          type the name. */}
        <p className="bs-field-hint">
          They need a Bindersnap account already — we cannot email an invitation
          yet. Anyone you add joins straight away and can read every binder that
          is open to the organization.
        </p>
      </form>
    </section>
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
  const orgName = useOrganizationDisplayName(org);
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
    <section className="bs-section" aria-labelledby="org-people-new-group">
      <div className="bs-section-head">
        <h3 className="bs-section-title" id="org-people-new-group">
          New group
        </h3>
      </div>
      <form className="bs-fields" onSubmit={submit}>
        <label className="bs-field">
          <span className="bs-field-label">Name</span>
          <input
            className="bs-input bs-input--sm"
            value={name}
            placeholder="Quality Committee"
            disabled={busy || saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        {handle === "" ? null : (
          <p className="bs-field-hint">
            {taken ? (
              <>
                {orgName} already has a group called <code>{handle}</code>.
              </>
            ) : (
              <>
                It will be called <code>{handle}</code>.
              </>
            )}
          </p>
        )}

        <fieldset className="bs-field">
          <legend className="bs-field-label">Level</legend>
          {GROUP_LEVELS.map((option) => (
            <label className="bs-choice" key={option.value}>
              <input
                type="radio"
                name="group-level"
                value={option.value}
                checked={level === option.value}
                disabled={busy || saving}
                onChange={() => setLevel(option.value)}
              />
              <span>
                <span className="bs-choice-name">{option.label}</span>
                <span className="bs-choice-note">{option.note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="org-people-actions">
          <button
            type="submit"
            className="bs-btn bs-btn-primary bs-btn--sm"
            disabled={busy || saving || handle === "" || taken}
          >
            {saving ? "Creating…" : "Create group"}
          </button>
        </div>

        {/* Said here because it is the question somebody asks next, and the
          answer is a reassurance: naming a group gives nobody access. */}
        <p className="bs-field-hint">
          A new group reaches no binder until somebody who runs that binder adds
          it.
        </p>
      </form>
    </section>
  );
}
