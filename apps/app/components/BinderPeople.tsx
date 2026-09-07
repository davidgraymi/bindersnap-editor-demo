import { useEffect, useState } from "react";

import {
  addBinderPerson,
  fetchBinderPeople,
  fetchOrganizationPeople,
  grantBinderGroup,
  removeBinderPerson,
  revokeBinderGroup,
  setBinderPersonLevel,
  setBinderVisibility,
} from "../api";
import type {
  BinderPeoplePayload,
  BinderPerson,
  OrganizationGroup,
} from "../../../packages/api-schema/schemas/workspaces";
import { GROUP_LEVELS, groupLevelLabel } from "../binderSettings";
import { describeGroupName } from "../../../packages/utils/groupName";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Who can act in this binder — one row per person, and the groups beneath.
 *
 * **A matrix loses**, because the roles are a ladder Gitea enforces as one: a
 * grid of checkboxes would let somebody try "can approve but cannot read",
 * which is not a thing and the screen would have to refuse it. **Grouping by
 * role loses too**, because it answers "who are the editors" when the question
 * a compliance manager asks is "what can Jane do" — which one row answers by
 * being read.
 *
 * The one thing this page cannot do is change a role that comes from a shared
 * group, because that group is one object across every binder it reaches. The
 * row names the group rather than offering a control that would have to refuse
 * — and the consolation is that "why can she approve here" is answered on the
 * row that raised the question.
 */

interface BinderPeopleProps {
  org: string;
  binder: string;
}

export function BinderPeople({ org, binder }: BinderPeopleProps) {
  const [payload, setPayload] = useState<BinderPeoplePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);

    fetchBinderPeople(org, binder)
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read who can act in this binder.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  async function run(act: () => Promise<BinderPeoplePayload>) {
    setBusy(true);
    setNotice(null);
    try {
      setPayload(await act());
    } catch (err: unknown) {
      // On the section, not the page. A refusal here is a sentence worth
      // reading — "she is here through Quality Committee, and that reaches
      // three binders" — and replacing the list with it would hide the row it
      // is about.
      setNotice(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  if (payload === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Reading who can act in this binder">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const seats = payload.people.filter((person) => person.seat).length;
  const free = payload.people.length - seats;

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">
          People
          <span className="doc-tab-count">{payload.people.length}</span>
        </h2>

        {/* Where "reviewers are free" has to land, and it is not the pricing
            page. A running count over the list somebody is already reading. */}
        <p className="doc-rail-note">
          {payload.people.length === 1
            ? "1 person"
            : `${payload.people.length} people`}
          {` · ${seats === 1 ? "1 seat" : `${seats} seats`} · ${free} free`}
        </p>

        {/* The switch sits above the list because it changes what the list
            means: when the whole organization can read, the list below stops
            being the whole answer, and the sentence under it says so. */}
        <VisibilitySwitch
          org={org}
          open={payload.openToOrganization}
          canManage={payload.canManage}
          busy={busy}
          onChange={(next) => run(() => setBinderVisibility(org, binder, next))}
        />

        {notice ? <p className="app-inline-error">{notice}</p> : null}

        {payload.people.length === 0 ? (
          <p style={{ color: "var(--bs-text-muted)" }}>
            Nobody is granted here, or your access does not let you see who is
            &mdash; Gitea shows a binder&rsquo;s teams to its admins.
          </p>
        ) : (
          <div className="docs-list">
            {payload.people.map((person) => (
              <PersonRow
                key={person.login}
                person={person}
                canManage={payload.canManage}
                busy={busy}
                onSetLevel={(level) =>
                  run(() =>
                    setBinderPersonLevel(org, binder, person.login, level),
                  )
                }
                onRemove={() =>
                  run(() => removeBinderPerson(org, binder, person.login))
                }
              />
            ))}
          </div>
        )}

        {payload.canManage ? (
          <AddPersonForm
            people={payload.organizationMembers}
            // Only the people whose grant here is this binder's own. Somebody
            // here through a group is still offered, because adding them
            // individually is the escape hatch — it is the only way to give one
            // member of a group more in this binder without changing every
            // binder that group reaches.
            already={payload.people
              .filter((person) => person.individual)
              .map((person) => person.login)}
            busy={busy}
            onAdd={(username, level) =>
              run(() => addBinderPerson(org, binder, username, level))
            }
          />
        ) : null}
      </section>

      <BinderGroups
        org={org}
        binder={binder}
        groups={payload.groups}
        canManage={payload.canManage}
        busy={busy}
        onChanged={run}
      />

      {payload.canManage ? null : (
        <p className="doc-rail-note">
          Only a binder administrator can change any of this.
        </p>
      )}
    </div>
  );
}

/**
 * Who can see this binder — one question, two answers.
 *
 * It is a radio pair rather than a toggle because the two states are a choice
 * somebody made, not an on and an off: "only people I add" is not the absence
 * of a setting, it is the answer an HR investigation binder needs. Both are
 * spelled out for the same reason the rules are — a state that is off is still
 * a state the customer chose.
 *
 * The cost of opening it is stated on the option rather than discovered
 * afterwards: read on a binder is what approving is, so everyone at the
 * organization can also approve there. For a policy manual that is right, and
 * where it is wrong the other option is the answer.
 */
function VisibilitySwitch({
  org,
  open,
  canManage,
  busy,
  onChange,
}: {
  org: string;
  open: boolean;
  canManage: boolean;
  busy: boolean;
  onChange: (open: boolean) => void;
}) {
  if (!canManage) {
    return (
      <p className="doc-rail-note">
        {open
          ? `Everyone at ${org} can read this binder and comment on changes. The people below can do more.`
          : "Only the people below can see this binder."}
      </p>
    );
  }

  return (
    <fieldset className="binder-visibility">
      <legend className="bs-label">Who can see this binder?</legend>

      <label className="org-choice">
        <input
          type="radio"
          name="binder-visibility"
          checked={open}
          disabled={busy}
          onChange={() => onChange(true)}
        />
        <span>
          <span className="docs-list-item-name">Everyone at {org}</span>
          <span className="docs-list-item-meta">
            They can read it and comment on changes — and approve them, because
            reading a change is what approving one costs. It uses no seats.
          </span>
        </span>
      </label>

      <label className="org-choice">
        <input
          type="radio"
          name="binder-visibility"
          checked={!open}
          disabled={busy}
          onChange={() => onChange(false)}
        />
        <span>
          <span className="docs-list-item-name">Only people I add</span>
          <span className="docs-list-item-meta">
            The people and groups below, and nobody else.
          </span>
        </span>
      </label>

      {open ? (
        <p className="doc-rail-note">The people below can do more than read.</p>
      ) : null}
    </fieldset>
  );
}

/**
 * Why this person can do what they can do here, in one line.
 *
 * The row that raises the question "why can Aisha approve here" is the row that
 * should answer it — which a dropdown never would. For somebody here through a
 * shared group that answer is the group's name, and it is also the reason the
 * dropdown is missing.
 */
function describeWhy(person: BinderPerson): string {
  if (!person.individual) {
    return `Through ${describeGroupName(person.through)}`;
  }

  if (person.groups.length === 0) return "Added to this binder";

  // Both are true and both matter: the individual grant is what this page can
  // change, and the groups are what would still hold them here if it did not.
  return `Added to this binder · also in ${person.groups
    .map(describeGroupName)
    .join(", ")}`;
}

/**
 * One person, and what is true of them here.
 *
 * A role is a dropdown rather than a modal: changing it is one Gitea call and
 * it is reversible, so putting it behind a dialog would imply a weight it does
 * not have. Somebody here through a group gets a label in its place — the
 * visible face of a real constraint rather than a design choice.
 */
function PersonRow({
  person,
  canManage,
  busy,
  onSetLevel,
  onRemove,
}: {
  person: BinderPerson;
  canManage: boolean;
  busy: boolean;
  onSetLevel: (level: string) => void;
  onRemove: () => void;
}) {
  const level =
    GROUP_LEVELS.find(
      (option) => option.label === groupLevelLabel(person.access),
    )?.value ?? "";

  // An owner reaches every binder in the organization through `Owners`, which
  // is not a grant here and cannot be changed here.
  const fixed = !person.individual;

  return (
    <div className="org-person">
      <PersonAvatar person={person} size="md" />
      <span className="org-person-body">
        <span className="docs-list-item-name">
          {person.fullName || person.login}
        </span>
        <span className="docs-list-item-meta">{describeWhy(person)}</span>
      </span>

      {canManage && !fixed ? (
        <select
          className="bs-input binder-role-select"
          value={level}
          disabled={busy}
          aria-label={`What ${person.fullName || person.login} can do here`}
          onChange={(event) => onSetLevel(event.target.value)}
        >
          {GROUP_LEVELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="doc-rail-row-note">
          {groupLevelLabel(person.access)}
        </span>
      )}

      {/* A fact, not a status, so it is quiet — but it is on every row,
          because "reviewers are free" is a promise somebody checks here. */}
      <span className="binder-seat-chip">{person.seat ? "Seat" : "Free"}</span>

      {canManage && !fixed ? (
        <button
          type="button"
          className="org-group-remove"
          disabled={busy}
          aria-label={`Take ${person.fullName || person.login} out of this binder`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/**
 * Adding one person, at one level.
 *
 * This is also the escape hatch the group constraint needs: when one member of
 * a group needs more in this one binder, they are added individually alongside
 * the group rather than the group being changed for every binder it reaches.
 */
function AddPersonForm({
  people,
  already,
  busy,
  onAdd,
}: {
  people: Array<{ login: string; fullName: string }>;
  /** Who already holds an individual grant here, and so has nothing to add. */
  already: string[];
  busy: boolean;
  onAdd: (username: string, level: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [level, setLevel] = useState("reviewer");

  const here = new Set(already.map((login) => login.toLowerCase()));
  const candidates = people.filter(
    (person) => !here.has(person.login.toLowerCase()),
  );

  return (
    <div className="org-group-add">
      <select
        className="bs-input org-group-select"
        value={username}
        disabled={busy || candidates.length === 0}
        onChange={(event) => setUsername(event.target.value)}
        aria-label="Add somebody to this binder"
      >
        <option value="">
          {candidates.length === 0
            ? "Everybody in the organization is already here"
            : "Add somebody…"}
        </option>
        {candidates.map((person) => (
          <option key={person.login} value={person.login}>
            {person.fullName || person.login}
          </option>
        ))}
      </select>

      <select
        className="bs-input binder-role-select"
        value={level}
        disabled={busy}
        onChange={(event) => setLevel(event.target.value)}
        aria-label="At what level"
      >
        {GROUP_LEVELS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="bs-btn bs-btn-secondary bs-btn--sm"
        disabled={busy || username === ""}
        onClick={() => {
          onAdd(username, level);
          setUsername("");
        }}
      >
        Add
      </button>

      {/* Said before the change rather than discovered on an invoice. The
          amount waits for billing; that it costs a seat does not. */}
      {level !== "reviewer" ? (
        <p className="doc-rail-note">
          Admins and editors use a seat. Reviewers are free, always — add as
          many as you like.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Gitea's built-in Owners team, which reaches every binder in the organization
 * implicitly rather than by a grant, so neither act applies to it.
 */
function isOwnersTeam(team: { name: string }): boolean {
  return team.name === "Owners";
}

/**
 * The groups granted onto this binder, under the people they explain.
 *
 * Composed here and made on the organization: a binder admin cannot create a
 * group, change its level, or change who is in it. Each grant and revoke also
 * rewrites the approvals whitelist, in the same request — a group granted here
 * but missing from that list has its members' approvals recorded, displayed,
 * and satisfying nothing.
 */
function BinderGroups({
  org,
  binder,
  groups,
  canManage,
  busy,
  onChanged,
}: {
  org: string;
  binder: string;
  groups: BinderPeoplePayload["groups"];
  canManage: boolean;
  busy: boolean;
  onChanged: (act: () => Promise<BinderPeoplePayload>) => void;
}) {
  const [available, setAvailable] = useState<OrganizationGroup[] | null>(null);
  const [adding, setAdding] = useState("");

  useEffect(() => {
    // Only an admin can compose, so only an admin pays for the picker.
    if (!canManage) return;

    let cancelled = false;
    fetchOrganizationPeople(org)
      .then((payload) => {
        if (!cancelled) setAvailable(payload.groups);
      })
      // Losing the picker costs the button, not the page.
      .catch(() => {
        if (!cancelled) setAvailable([]);
      });

    return () => {
      cancelled = true;
    };
  }, [org, canManage]);

  const granted = new Set(groups.map((group) => group.name.toLowerCase()));
  const candidates = (available ?? []).filter(
    (group) => !granted.has(group.name.toLowerCase()) && !isOwnersTeam(group),
  );

  return (
    <section className="binder-settings-section">
      <h2 className="doc-rail-title">Groups with access</h2>

      {groups.length === 0 ? (
        <p style={{ color: "var(--bs-text-muted)" }}>
          No groups are granted onto this binder.
        </p>
      ) : (
        groups.map((group) => (
          <div className="binder-team" key={group.id}>
            <div className="binder-team-head">
              <span className="binder-team-name">
                {describeGroupName(group.name)}
                <span className="org-group-level">
                  {groupLevelLabel(group.access)}
                </span>
              </span>
              <span className="doc-rail-row-note">
                {group.members.length === 1
                  ? "1 person"
                  : `${group.members.length} people`}
              </span>
              {canManage && !isOwnersTeam(group) ? (
                <button
                  type="button"
                  className="bs-btn bs-btn-secondary bs-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    onChanged(async () => {
                      await revokeBinderGroup(org, binder, group.name);
                      return fetchBinderPeople(org, binder);
                    })
                  }
                >
                  Remove from this binder
                </button>
              ) : null}
            </div>
          </div>
        ))
      )}

      {canManage ? (
        <div className="org-group-add">
          <select
            className="bs-input org-group-select"
            value={adding}
            disabled={busy || candidates.length === 0}
            onChange={(event) => setAdding(event.target.value)}
            aria-label="Add a group to this binder"
          >
            <option value="">
              {available === null
                ? "Reading this organization's groups…"
                : candidates.length === 0
                  ? "Every group is already here"
                  : "Add a group…"}
            </option>
            {candidates.map((group) => (
              <option key={group.id} value={group.name}>
                {describeGroupName(group.name)} ·{" "}
                {groupLevelLabel(group.access)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            disabled={busy || adding === ""}
            onClick={() => {
              const group = adding;
              setAdding("");
              onChanged(async () => {
                await grantBinderGroup(org, binder, group);
                return fetchBinderPeople(org, binder);
              });
            }}
          >
            Add
          </button>
        </div>
      ) : null}

      <p className="doc-rail-note">
        A group carries one level everywhere it is used, so its level and its
        people are set on the organization.
      </p>
    </section>
  );
}
