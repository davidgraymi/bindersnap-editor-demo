import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  FileText,
  Folder,
  Library,
  Lock,
  Pencil,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useIsReadOnly } from "../readOnlyContext";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

import {
  addBinderPerson,
  describeBinder,
  fetchBinder,
  fetchBinderPeople,
  fetchBinderSettings,
  fetchOrganizationPeople,
  grantBinderGroup,
  proposeBinderSignOff,
  removeBinderPerson,
  renameBinder,
  revokeBinderGroup,
  setBinderPersonLevel,
  setBinderRules,
  setBinderVisibility,
} from "../api";
import type {
  BinderPeoplePayload,
  BinderPerson,
  OrganizationGroup,
  SignOffDocumentView,
  SignOffRuleView,
  WorkspaceSettingsPayload,
} from "../../../packages/api-schema/schemas/workspaces";
import { GROUP_LEVELS, groupLevelLabel } from "../binderSettings";
import { formatDocumentName } from "../documentDisplay";
import { describeGroupName } from "../../../packages/utils/groupName";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * How this binder is governed — one page, one scroll, six blocks.
 *
 * **It was three tabs**: People, Sign-off rules and Settings, each visited a
 * handful of times a year and drawn as peers of the tree somebody opens every
 * morning. They are one question — who can do what here, and what has to be
 * true before a policy changes — so they are one page. No index down the side:
 * six short blocks you can read in one scroll do not need a map to reach
 * something already on screen.
 *
 * **People, Groups and Sign-off rules are one shape.** A panel of rows with a
 * single footer that adds to it — pick the thing, pick the level, Add. They
 * had three shapes, and adding a person and adding a group are the same act.
 *
 * **Most of the explanatory notes are gone.** Each was true and each was us
 * talking over the customer's own screen. The sentences that survive are the
 * ones that change what somebody would do: a rule that is holding nothing, a
 * binder whose rules are not enforced, and that changing the rules needs an
 * approval.
 *
 * See D5 in `docs/design/binder-screens-spec.md`.
 */

export type BinderSettingsSection = "people" | "sign-off";

interface BinderSettingsProps {
  org: string;
  binder: string;
  /**
   * A block to scroll to once the page has read, for the addresses that were
   * tabs of their own — `?tab=people` and `?tab=sign-off` still resolve.
   */
  focus?: BinderSettingsSection;
  /**
   * The binder's new address, once it has one.
   *
   * The page this sits on is addressed by the name that just stopped being the
   * binder's, so somebody above has to move it.
   */
  onRenamed?: (binder: string) => void;
  /** Its description changed, so the header that shows it has to re-read. */
  onDescribed?: () => void;
  onOpenChange: (changeNumber: number) => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

export function BinderSettings({
  org,
  binder,
  focus,
  onRenamed,
  onDescribed,
  onOpenChange,
}: BinderSettingsProps) {
  // The same fold every other editable surface uses: a delinquent organization
  // draws no controls, by the one flag that already decides whether controls
  // exist.
  const isReadOnly = useIsReadOnly();
  const [settings, setSettings] = useState<WorkspaceSettingsPayload | null>(
    null,
  );
  const [people, setPeople] = useState<BinderPeoplePayload | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const peopleRef = useRef<HTMLElement>(null);
  const signOffRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setPeople(null);
    setDescription(null);
    setError(null);

    Promise.all([
      fetchBinderSettings(org, binder),
      fetchBinderPeople(org, binder),
      // The description is a nicety on this page, not its point: a binder
      // whose overview cannot be read still has settings to change.
      fetchBinder(org, binder)
        .then((overview) => overview.workspace.description ?? "")
        .catch(() => ""),
    ])
      .then(([nextSettings, nextPeople, nextDescription]) => {
        if (cancelled) return;
        setSettings(nextSettings);
        setPeople(nextPeople);
        setDescription(nextDescription);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, "Unable to read this binder's settings."));
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  const loaded = settings !== null && people !== null && description !== null;

  // Once, when the page has something to scroll to. A block that is not drawn
  // yet has no position.
  useEffect(() => {
    if (!loaded || !focus) return;
    const target = focus === "people" ? peopleRef : signOffRef;
    target.current?.scrollIntoView({ block: "start" });
  }, [loaded, focus]);

  if (error) {
    return (
      <p className="bs-note bs-note--danger" role="alert">
        {error}
      </p>
    );
  }

  if (!loaded) {
    return (
      <div className="binder-pane bs-settings">
        <SkeletonGroup label="Reading this binder's settings">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const canManage = settings.canManage && !isReadOnly;
  const canManagePeople = people.canManage && !isReadOnly;

  return (
    <div className="binder-pane bs-settings">
      <SettingsGroup
        id="binder-settings-general"
        title="General"
        note="What this binder is called, and what it is for."
      >
        {canManage ? (
          <NameAndDescription
            org={org}
            binder={binder}
            description={description}
            onRenamed={onRenamed}
            onDescribed={(next) => {
              setDescription(next);
              onDescribed?.();
            }}
          />
        ) : (
          // Said once, at the top, rather than as a missing control in every
          // block below.
          <p className="bs-section-note">
            Only a binder administrator can change these settings.
          </p>
        )}
      </SettingsGroup>

      <SettingsGroup
        id="binder-settings-access"
        title="Access"
        note="Who can read this binder, and what each person can do in it."
      >
        <PeopleSections
          ref={peopleRef}
          org={org}
          binder={binder}
          payload={people}
          canManage={canManagePeople}
          onChanged={setPeople}
        />
      </SettingsGroup>

      <SettingsGroup
        id="binder-settings-review"
        title="Review and publishing"
        note="What has to be true before a change becomes the published version."
      >
        <SignOffSection
          ref={signOffRef}
          org={org}
          binder={binder}
          settings={settings}
          canManage={canManage}
          onOpenChange={onOpenChange}
        />

        <ApprovalSection
          org={org}
          binder={binder}
          settings={settings}
          canManage={canManage}
          onChanged={setSettings}
        />
      </SettingsGroup>
    </div>
  );
}

/**
 * One of the page's three questions, with a sentence saying which.
 *
 * **GitLab's settings page, without the accordion.** What it gets right is the
 * hierarchy: a few named groups, each saying in one line what it holds, with
 * the individual settings as subsections under it. Six headings of equal
 * weight made "Groups" and "How changes are approved" look like the same kind
 * of thing, and nothing said that the visibility choice, the people and the
 * groups are three halves of one answer. What it gets wrong for a page this
 * short is folding: six blocks read in one scroll, and a closed section is a
 * setting nobody checks.
 */
function SettingsGroup({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="bs-section bs-settings-group" aria-labelledby={id}>
      <header className="bs-settings-group-head">
        <h2 className="bs-settings-group-title" id={id}>
          {title}
        </h2>
        <p className="bs-settings-group-note">{note}</p>
      </header>
      <div className="bs-settings-group-body">{children}</div>
    </section>
  );
}

/* ── Name and description ─────────────────────────────────────────────── */

/**
 * What the binder is called and what it is for, with one Save for both.
 *
 * A Rename button beside the name said the name was a different kind of thing
 * from the description under it — two commits for one edit, and the second
 * field with no way to commit it at all.
 */
function NameAndDescription({
  org,
  binder,
  description,
  onRenamed,
  onDescribed,
}: {
  org: string;
  binder: string;
  description: string;
  onRenamed?: (binder: string) => void;
  onDescribed: (description: string) => void;
}) {
  const current = formatDocumentName(binder);
  const [name, setName] = useState(current);
  const [about, setAbout] = useState(description);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const nameChanged = name.trim() !== "" && name.trim() !== current;
  const aboutChanged = about.trim() !== description.trim();

  async function save() {
    if (saving || (!nameChanged && !aboutChanged)) return;
    setSaving(true);
    setNotice(null);
    try {
      // The description first, while the binder still answers to the name the
      // page is addressed by. A rename moves the page.
      if (aboutChanged) {
        const saved = await describeBinder(org, binder, about.trim());
        onDescribed(saved.description);
      }
      if (nameChanged) {
        const renamed = await renameBinder(org, binder, name.trim());
        onRenamed?.(renamed.workspace);
        return;
      }
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Unable to save this binder's name."));
    }
    setSaving(false);
  }

  return (
    <section className="bs-section" aria-label="Name and description">
      <form
        className="bs-fields"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="bs-field">
          <label className="bs-field-label" htmlFor="binder-settings-name">
            Name
          </label>
          <input
            className="bs-input"
            id="binder-settings-name"
            type="text"
            value={name}
            disabled={saving}
            aria-describedby="binder-settings-name-hint"
            onChange={(event) => {
              setName(event.target.value);
              setNotice(null);
            }}
          />
          {/* The one consequence of a rename somebody would want to know
              before pressing Save: the address moves, and links survive. */}
          <p className="bs-field-hint" id="binder-settings-name-hint">
            Renaming it changes its address. Links to the old address keep
            working.
          </p>
        </div>
        <div className="bs-field">
          <label
            className="bs-field-label"
            htmlFor="binder-settings-description"
          >
            Description
            <span className="bs-field-optional">optional</span>
          </label>
          <textarea
            className="bs-input bs-settings-description"
            id="binder-settings-description"
            value={about}
            disabled={saving}
            rows={2}
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
        <div className="bs-field-row">
          <button
            type="submit"
            className="bs-btn bs-btn--sm bs-btn-primary"
            disabled={saving || (!nameChanged && !aboutChanged)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}

/* ── Who can see it, people and groups ────────────────────────────────── */

/**
 * The organization's Owners team reaches every binder implicitly rather than
 * by a grant, so neither adding nor removing applies to it.
 */
function isOwnersTeam(team: { name: string }): boolean {
  return team.name === "Owners";
}

/**
 * Why this person can do what they can do here, in one line.
 *
 * The row that raises "why can Aisha approve here" is the row that answers it
 * — and for somebody here through a shared group that answer is the group's
 * name, which is also why the row has no role picker.
 */
function describeWhy(person: BinderPerson): string {
  if (!person.individual) {
    return `Through ${describeGroupName(person.through)}`;
  }
  if (person.groups.length === 0) return "Added to this binder";
  return `Added to this binder · also in ${person.groups
    .map(describeGroupName)
    .join(", ")}`;
}

function PeopleSections({
  ref,
  org,
  binder,
  payload,
  canManage,
  onChanged,
}: {
  ref: React.Ref<HTMLElement>;
  org: string;
  binder: string;
  payload: BinderPeoplePayload;
  canManage: boolean;
  onChanged: (payload: BinderPeoplePayload) => void;
}) {
  const orgDisplayName = useOrganizationDisplayName(org);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(act: () => Promise<BinderPeoplePayload>) {
    setBusy(true);
    setNotice(null);
    try {
      onChanged(await act());
    } catch (err: unknown) {
      // On the block, not the page. A refusal here is a sentence worth
      // reading — "she is here through Quality Committee, and that reaches
      // three binders" — and replacing the list with it would hide the row.
      setNotice(errorMessage(err, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  const open = payload.openToOrganization;

  return (
    <>
      <section className="bs-section" aria-labelledby="binder-settings-seen">
        <div className="bs-section-head">
          <h3 className="bs-section-title" id="binder-settings-seen">
            Who can see this binder
          </h3>
        </div>
        {canManage ? (
          /* A radio pair rather than a toggle: the two states are a choice
             somebody made, not an on and an off. "Only the people below" is
             the answer an HR investigation binder needs, not the absence of a
             setting. */
          <div
            className="bs-fields"
            role="radiogroup"
            aria-labelledby="binder-settings-seen"
          >
            <label className="bs-choice">
              <input
                type="radio"
                name="binder-visibility"
                checked={open}
                disabled={busy}
                onChange={() =>
                  void run(() => setBinderVisibility(org, binder, true))
                }
              />
              <Building2
                className="bs-choice-icon"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                <span className="bs-choice-name">
                  Everyone at {orgDisplayName}
                </span>
                <span className="bs-choice-note">
                  They can read it and comment on changes — and approve them,
                  because reading a change is what approving one costs.
                </span>
              </span>
            </label>
            <label className="bs-choice">
              <input
                type="radio"
                name="binder-visibility"
                checked={!open}
                disabled={busy}
                onChange={() =>
                  void run(() => setBinderVisibility(org, binder, false))
                }
              />
              <Lock
                className="bs-choice-icon"
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                <span className="bs-choice-name">Only the people below</span>
                <span className="bs-choice-note">
                  These people and groups, and nobody else.
                </span>
              </span>
            </label>
          </div>
        ) : (
          <p className="bs-section-note">
            {open
              ? `Everyone at ${orgDisplayName} can read this binder and comment on changes. The people below can do more.`
              : "Only the people below can see this binder."}
          </p>
        )}
      </section>

      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}

      <section
        className="bs-section"
        id="people"
        ref={ref}
        aria-labelledby="binder-settings-people"
      >
        <div className="bs-section-head">
          <h3 className="bs-section-title" id="binder-settings-people">
            People
          </h3>
          <span className="bs-section-count">{payload.people.length}</span>
        </div>
        <div className="bs-panel">
          {payload.people.length === 0 ? (
            <div className="bs-empty">
              <p>
                Nobody is granted here, or your access does not let you see who
                is — Gitea shows a binder&rsquo;s teams to its admins.
              </p>
            </div>
          ) : (
            <ul className="bs-row-list">
              {payload.people.map((person) => (
                <PersonRow
                  key={person.login}
                  person={person}
                  canManage={canManage}
                  busy={busy}
                  onSetLevel={(level) =>
                    void run(() =>
                      setBinderPersonLevel(org, binder, person.login, level),
                    )
                  }
                  onRemove={() =>
                    void run(() =>
                      removeBinderPerson(org, binder, person.login),
                    )
                  }
                />
              ))}
            </ul>
          )}
          {canManage ? (
            <AddPersonFoot
              people={payload.organizationMembers}
              // Only individual grants. Somebody here through a group is still
              // offered, because adding them individually is the one way to
              // give a single member of a group more in this binder.
              already={payload.people
                .filter((person) => person.individual)
                .map((person) => person.login)}
              busy={busy}
              onAdd={(username, level) =>
                void run(() => addBinderPerson(org, binder, username, level))
              }
            />
          ) : null}
        </div>
      </section>

      <GroupsSection
        org={org}
        binder={binder}
        groups={payload.groups}
        canManage={canManage}
        busy={busy}
        onChanged={(act) => void run(act)}
      />
    </>
  );
}

function RemoveButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="bs-rowact bs-rowact--danger"
      disabled={busy}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <AppIcon icon={X} size="sm" />
    </button>
  );
}

/**
 * One person, and what is true of them here.
 *
 * A role is a dropdown rather than a dialog: changing it is one Gitea call and
 * reversible. Somebody here through a group gets their level as text in its
 * place — the visible face of a real constraint, since that group is one
 * object across every binder it reaches.
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
  const name = person.fullName || person.login;
  const level =
    GROUP_LEVELS.find(
      (option) => option.label === groupLevelLabel(person.access),
    )?.value ?? "";
  const editable = canManage && person.individual;

  return (
    <li className="bs-row">
      <PersonAvatar person={person} size="sm" />
      <span className="bs-row-body">
        <span className="bs-row-name">{name}</span>
        <span className="bs-row-meta">{describeWhy(person)}</span>
      </span>
      <span className="bs-row-right">
        {editable ? (
          <>
            <select
              className="bs-input bs-input--sm bs-settings-level"
              value={level}
              disabled={busy}
              aria-label={`What ${name} can do here`}
              onChange={(event) => onSetLevel(event.target.value)}
            >
              {GROUP_LEVELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <RemoveButton
              label={`Take ${name} out of this binder`}
              busy={busy}
              onClick={onRemove}
            />
          </>
        ) : (
          <span>{groupLevelLabel(person.access)}</span>
        )}
      </span>
    </li>
  );
}

function AddPersonFoot({
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
    <div className="bs-panel-foot">
      <select
        className="bs-input bs-input--sm bs-settings-pick"
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
        className="bs-input bs-input--sm bs-settings-level"
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
        className="bs-btn bs-btn--sm bs-btn-secondary"
        disabled={busy || username === ""}
        onClick={() => {
          onAdd(username, level);
          setUsername("");
        }}
      >
        Add
      </button>
    </div>
  );
}

/**
 * The groups granted onto this binder.
 *
 * Composed here and made on the organization: a group carries one level
 * everywhere it is used, so the footer has no level picker — the level is in
 * the option. Each grant and revoke also rewrites the approvals whitelist in
 * the same request, which is what makes its members' approvals count.
 */
function GroupsSection({
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
      // Losing the picker costs the footer, not the page.
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
    <section className="bs-section" aria-labelledby="binder-settings-groups">
      <div className="bs-section-head">
        <h3 className="bs-section-title" id="binder-settings-groups">
          Groups
        </h3>
        <span className="bs-section-count">{groups.length}</span>
      </div>
      <div className="bs-panel">
        {groups.length === 0 ? (
          <div className="bs-empty">
            <p>No groups are granted onto this binder.</p>
          </div>
        ) : (
          <ul className="bs-row-list">
            {groups.map((group) => {
              const name = describeGroupName(group.name);
              const count = group.members.length;
              return (
                <li className="bs-row" key={group.id}>
                  <span className="bs-row-icon">
                    <AppIcon icon={Users} size="md" />
                  </span>
                  <span className="bs-row-body">
                    <span className="bs-row-name">{name}</span>
                    {/* A group with nobody in it grants nothing and, named by
                        a sign-off rule, waits for nobody. Said on the row
                        that grants it. */}
                    <span
                      className={`bs-row-meta${count === 0 ? " bs-row-meta--warn" : ""}`}
                    >
                      {count === 0
                        ? "Nobody in it yet"
                        : count === 1
                          ? "1 person"
                          : `${count} people`}
                    </span>
                  </span>
                  <span className="bs-row-right">
                    <span>{groupLevelLabel(group.access)}</span>
                    {canManage && !isOwnersTeam(group) ? (
                      <RemoveButton
                        label={`Take ${name} out of this binder`}
                        busy={busy}
                        onClick={() =>
                          onChanged(async () => {
                            await revokeBinderGroup(org, binder, group.name);
                            return fetchBinderPeople(org, binder);
                          })
                        }
                      />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {canManage ? (
          <div className="bs-panel-foot">
            <select
              className="bs-input bs-input--sm bs-settings-pick"
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
              className="bs-btn bs-btn--sm bs-btn-secondary"
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
      </div>
    </section>
  );
}

/* ── Sign-off rules ───────────────────────────────────────────────────── */

/** A rule on screen. `key` survives the rule's target being changed. */
interface DraftRule extends SignOffRuleView {
  key: string;
}

let nextKey = 0;
function draftFrom(rule: SignOffRuleView): DraftRule {
  nextKey += 1;
  return { ...rule, key: `rule-${nextKey}` };
}

/**
 * The picker's value: scope and target in one string.
 *
 * One `<select>` rather than two controls, because "what has to be signed off"
 * is one question. The split is on the first colon only, since a folder path
 * may contain anything.
 */
function targetValue(rule: Pick<SignOffRuleView, "scope" | "target">) {
  return rule.scope === "binder" || rule.scope === "rules"
    ? rule.scope
    : `${rule.scope}:${rule.target}`;
}

function parseTargetValue(
  value: string,
): Pick<SignOffRuleView, "scope" | "target"> {
  if (value === "binder") return { scope: "binder", target: "" };
  if (value === "rules") return { scope: "rules", target: "" };
  const at = value.indexOf(":");
  return {
    scope: value.slice(0, at) === "document" ? "document" : "folder",
    target: value.slice(at + 1),
  };
}

/** The part of a rule that is sent, in an order that compares. */
function ruleSignature(rules: SignOffRuleView[]): string {
  return JSON.stringify(
    rules.map(({ scope, target, teams, users }) => [
      scope,
      target,
      [...teams].sort(),
      [...users].sort(),
    ]),
  );
}

/** "A", "A and B", "A, B and C" — the way a person would say a list. */
function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `clinical/nursing` → "Clinical / Nursing". A folder is a slug too. */
export function describeFolder(folder: string): string {
  return folder.split("/").map(formatDocumentName).join(" / ");
}

/**
 * What a rule covers, as a customer reads it.
 *
 * A document rule carries an identity, which is not a thing to put in front of
 * anybody, so it is looked up in the binder's own list. One that is not there
 * is **said**, not hidden: a rule about a document this binder no longer holds
 * enforces nothing.
 */
export function describeTarget(
  rule: Pick<SignOffRuleView, "scope" | "target">,
  documents: readonly SignOffDocumentView[],
): string {
  switch (rule.scope) {
    case "binder":
      return "Everything in this binder";
    case "folder":
      return `Anything filed in ${describeFolder(rule.target)}`;
    case "document": {
      const match = documents.find((entry) => entry.uid === rule.target);
      return match
        ? formatDocumentName(match.name)
        : "A document that is no longer in this binder";
    }
    case "rules":
      // Said as what it governs rather than as the file it is. Nobody here is
      // thinking about `.gitea/CODEOWNERS`.
      return "Who signs things off in this binder";
  }
}

/**
 * Who signs a rule off, on the rule's own row.
 *
 * **A group with nobody in it is said here, and only here.** Verified against a
 * running Gitea: a rule whose owners are an empty team waits for nobody and
 * lets the publish through. This is the one screen in the product that could
 * ever say so, and it says it on the row that is holding nothing rather than in
 * a paragraph above the list.
 */
export function describeOwners(
  rule: Pick<SignOffRuleView, "teams" | "users">,
  emptyGroups: readonly string[],
): { text: string; holdingNothing: boolean } {
  const empty = new Set(emptyGroups);
  const owners = [
    ...rule.teams.map((team) =>
      empty.has(team)
        ? `the ${describeGroupName(team)} group, which has nobody in it`
        : describeGroupName(team),
    ),
    ...rule.users,
  ];

  if (owners.length === 0) {
    return { text: "Nobody signs this off yet", holdingNothing: true };
  }

  const text = listSentence(owners);
  return {
    text: `${text.charAt(0).toUpperCase()}${text.slice(1)}`,
    holdingNothing:
      rule.users.length === 0 && rule.teams.every((team) => empty.has(team)),
  };
}

function scopeIcon(scope: SignOffRuleView["scope"]) {
  switch (scope) {
    case "binder":
      return Library;
    case "folder":
      return Folder;
    case "document":
      return FileText;
    case "rules":
      return ShieldCheck;
  }
}

/**
 * The two pickers a rule is made of.
 *
 * Whatever the rule already points at stays on the list even if the binder no
 * longer holds it, so opening a rule to fix its group cannot silently retarget
 * it at whichever folder sorts first.
 */
function RulePickers({
  target,
  team,
  folders,
  documents,
  groups,
  busy,
  current,
  onTarget,
  onTeam,
}: {
  target: string;
  team: string;
  folders: string[];
  documents: SignOffDocumentView[];
  groups: string[];
  busy: boolean;
  /** The rule being edited, so a target the binder no longer holds is kept. */
  current?: Pick<SignOffRuleView, "scope" | "target">;
  onTarget: (value: string) => void;
  onTeam: (value: string) => void;
}) {
  const missing =
    current !== undefined &&
    current.scope !== "binder" &&
    current.scope !== "rules" &&
    !folders.includes(current.target) &&
    !documents.some((entry) => entry.uid === current.target);

  return (
    <>
      <select
        className="bs-input bs-input--sm bs-settings-pick"
        value={target}
        disabled={busy}
        aria-label="What has to be signed off"
        onChange={(event) => onTarget(event.target.value)}
      >
        {current === undefined ? (
          <option value="">What it covers…</option>
        ) : null}
        <option value="binder">Everything in this binder</option>
        {missing ? (
          <option value={targetValue(current)}>
            {describeTarget(current, documents)}
          </option>
        ) : null}
        {folders.length > 0 ? (
          <optgroup label="A folder">
            {folders.map((folder) => (
              <option key={folder} value={`folder:${folder}`}>
                {describeFolder(folder)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {documents.length > 0 ? (
          <optgroup label="One document">
            {documents.map((entry) => (
              <option key={entry.uid} value={`document:${entry.uid}`}>
                {formatDocumentName(entry.name)}
                {entry.folder === ""
                  ? ""
                  : ` — ${describeFolder(entry.folder)}`}
              </option>
            ))}
          </optgroup>
        ) : null}
        {/* Last: the rarest thing to choose and the worst to land on by
            accident — but present, because without it anybody who can open a
            change request can propose removing every rule on this page. */}
        <option value="rules">Who signs things off in this binder</option>
      </select>
      <select
        className="bs-input bs-input--sm bs-settings-pick"
        value={team}
        disabled={busy}
        aria-label="Which group signs it off"
        onChange={(event) => onTeam(event.target.value)}
      >
        <option value="">Signed off by…</option>
        {groups.map((group) => (
          <option key={group} value={group}>
            {describeGroupName(group)}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Who has to sign off on what.
 *
 * **Saving does not save, and that is the feature.** Changing who signs off is
 * itself a change to the binder, so the rows here are a draft of the whole set
 * and "Propose these rules" opens a change request for it. A customer buying
 * "nothing changes without approval" who found the rules could be changed
 * silently would have found the hole in the product.
 *
 * **No state pill on a rule.** A rule on this page *is* the binder's rule; an
 * "Enforced" chip on every row was the page repeating its title once per line.
 * What is worth saying — that the binder is not enforcing any of them, or that
 * one is holding nothing — is said where it applies.
 */
function SignOffSection({
  ref,
  org,
  binder,
  settings,
  canManage,
  onOpenChange,
}: {
  ref: React.Ref<HTMLElement>;
  org: string;
  binder: string;
  settings: WorkspaceSettingsPayload;
  canManage: boolean;
  onOpenChange: (changeNumber: number) => void;
}) {
  const signOff = settings.signOff;
  const [draft, setDraft] = useState<DraftRule[]>(() =>
    signOff.rules.map(draftFrom),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);

  const pending = signOff.pendingChange;
  const changed = ruleSignature(draft) !== ruleSignature(signOff.rules);
  // Two open at once would leave competing versions of the rules in review,
  // and whichever was published last would silently win.
  const drafting = canManage && pending === null && opened === null;

  async function propose() {
    setSaving(true);
    setNotice(null);
    try {
      const result = await proposeBinderSignOff(
        org,
        binder,
        draft.map(({ scope, target, teams, users }) => ({
          scope,
          target,
          teams,
          users,
        })),
      );
      setEditing(null);
      setOpened(result.changeNumber);
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Unable to propose these rules."));
    } finally {
      setSaving(false);
    }
  }

  const update = (key: string, next: Partial<SignOffRuleView>) =>
    setDraft(
      draft.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)),
    );

  const empty = draft.length === 0 && signOff.unreadable.length === 0;

  return (
    <section
      className="bs-section"
      id="sign-off"
      ref={ref}
      aria-labelledby="binder-settings-sign-off"
    >
      <div className="bs-section-head">
        <h3 className="bs-section-title" id="binder-settings-sign-off">
          Sign-off rules
        </h3>
        {signOff.rules.length > 0 ? (
          <span className="bs-section-count">{signOff.rules.length}</span>
        ) : null}
      </div>

      {/* First, because rules that are listed but not enforced are worse than
          no rules at all: the page would be promising something that is not
          happening. */}
      {signOff.enforced || signOff.rules.length === 0 ? null : (
        <p className="bs-note bs-note--danger" role="alert">
          This binder is not holding changes for these rules, so a change can be
          published without the sign-off below. Ask an administrator to check
          the binder&rsquo;s protection rules.
        </p>
      )}

      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="bs-panel">
        {empty ? (
          /* The empty state is the section, so it says what a rule is rather
             than only that there is none. It disappears the moment a rule
             exists, which is what keeps it from being a permanent rail. */
          <div className="bs-empty bs-settings-signoff-empty">
            <p className="bs-empty-lead">
              Nothing here needs its own sign-off yet.
            </p>
            <p>
              Every change to this binder needs its usual approvals, whatever it
              touches. A sign-off rule adds a second requirement to one part of
              it —{" "}
              <em>
                the infection control group signs off on anything filed in
                nursing
              </em>{" "}
              — so a document cannot be published without the people who own
              that subject.
            </p>
            <p>
              A rule can cover this whole binder, one folder, a single document,
              or these rules themselves — and a change that lands under two
              rules needs both.
            </p>
          </div>
        ) : (
          <ul className="bs-row-list">
            {draft.map((rule) =>
              editing === rule.key && drafting ? (
                <li className="bs-row bs-row--on" key={rule.key}>
                  <RulePickers
                    target={targetValue(rule)}
                    team={rule.teams[0] ?? ""}
                    folders={signOff.folders}
                    documents={signOff.documents}
                    groups={signOff.groups}
                    busy={saving}
                    current={rule}
                    onTarget={(value) =>
                      update(rule.key, parseTargetValue(value))
                    }
                    onTeam={(value) =>
                      update(rule.key, { teams: value === "" ? [] : [value] })
                    }
                  />
                  <button
                    type="button"
                    className="bs-btn bs-btn--sm bs-btn-secondary"
                    onClick={() => setEditing(null)}
                  >
                    Done
                  </button>
                </li>
              ) : (
                <RuleRow
                  key={rule.key}
                  rule={rule}
                  documents={signOff.documents}
                  emptyGroups={signOff.emptyGroups}
                  actions={
                    drafting ? (
                      <span className="bs-rowacts">
                        <button
                          type="button"
                          className="bs-rowact"
                          disabled={saving}
                          aria-label={`Change the rule for ${describeTarget(rule, signOff.documents)}`}
                          title="Change"
                          onClick={() => setEditing(rule.key)}
                        >
                          <AppIcon icon={Pencil} size="sm" />
                        </button>
                        <RemoveButton
                          label={`Remove the rule for ${describeTarget(rule, signOff.documents)}`}
                          busy={saving}
                          onClick={() =>
                            setDraft(
                              draft.filter((entry) => entry.key !== rule.key),
                            )
                          }
                        />
                      </span>
                    ) : null
                  }
                />
              ),
            )}
            {/* A rule the screen omitted would be a rule somebody believes is
                not there. Gitea drops what it cannot read with only a log
                warning, so this row is the only place it is ever visible. */}
            {signOff.unreadable.map((line) => (
              <li className="bs-row" key={`unreadable-${line.line}`}>
                <span className="bs-row-icon bs-row-icon--warn">
                  <AppIcon icon={AlertTriangle} size="md" />
                </span>
                <span className="bs-row-body">
                  <span className="bs-row-name">
                    A rule that cannot be read, and enforces nothing
                  </span>
                  <span className="bs-row-meta">
                    <code className="bs-filename">{line.text}</code>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {drafting ? (
          <>
            {/* The same footer People and Groups have: what it covers, who
                signs it off, Add. */}
            <div className="bs-panel-foot">
              <RulePickers
                target={newTarget}
                team={newTeam}
                folders={signOff.folders}
                documents={signOff.documents}
                groups={signOff.groups}
                busy={saving}
                onTarget={setNewTarget}
                onTeam={setNewTeam}
              />
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-secondary"
                aria-label="Add a rule"
                disabled={saving || newTarget === "" || newTeam === ""}
                onClick={() => {
                  setDraft([
                    ...draft,
                    draftFrom({
                      ...parseTargetValue(newTarget),
                      teams: [newTeam],
                      users: [],
                    }),
                  ]);
                  setNewTarget("");
                  setNewTeam("");
                }}
              >
                Add
              </button>
            </div>

            {/* Why the policy picker is short, when it is. A document rule is
                keyed on the identity in the filename, so a binder filed
                before that existed offers no documents at all. */}
            {signOff.documents.length === 0 &&
            signOff.unnameableDocuments > 0 ? (
              <div className="bs-panel-foot">
                {signOff.unnameableDocuments === 1
                  ? "The document in this binder was filed before Bindersnap tracked documents individually, so a rule can only cover its folder."
                  : `The ${signOff.unnameableDocuments} documents in this binder were filed before Bindersnap tracked documents individually, so a rule can only cover their folders.`}
              </div>
            ) : null}

            <div className="bs-panel-foot">
              <span className="bs-panel-foot-note">
                Changing these rules is itself a change to the binder, so it
                goes through the same approval your documents do.
              </span>
              {changed ? (
                <button
                  type="button"
                  className="bs-btn bs-btn--sm bs-btn--quiet"
                  disabled={saving}
                  onClick={() => {
                    setEditing(null);
                    setDraft(signOff.rules.map(draftFrom));
                  }}
                >
                  Undo
                </button>
              ) : null}
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-primary"
                disabled={saving || !changed}
                onClick={() => void propose()}
              >
                {saving ? "Opening a change…" : "Propose these rules"}
              </button>
            </div>
          </>
        ) : canManage && (opened ?? pending) !== null ? (
          <div className="bs-panel-foot">
            <span className="bs-panel-foot-note">
              {opened !== null
                ? "We opened a change request for these rules. Nothing takes effect until it is approved and published."
                : "A change to these rules is already waiting for a decision."}
            </span>
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn-secondary"
              onClick={() => onOpenChange((opened ?? pending)!)}
            >
              Review the change
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RuleRow({
  rule,
  documents,
  emptyGroups,
  actions,
}: {
  rule: SignOffRuleView;
  documents: SignOffDocumentView[];
  emptyGroups: string[];
  actions: ReactNode;
}) {
  const owners = describeOwners(rule, emptyGroups);
  return (
    <li className="bs-row">
      <span className="bs-row-icon">
        <AppIcon icon={scopeIcon(rule.scope)} size="md" />
      </span>
      <span className="bs-row-body">
        <span className="bs-row-name">{describeTarget(rule, documents)}</span>
        <span
          className={`bs-row-meta${owners.holdingNothing ? " bs-row-meta--warn" : ""}`}
        >
          {owners.text}
        </span>
      </span>
      {actions ? <span className="bs-row-right">{actions}</span> : null}
    </li>
  );
}

/* ── How changes are approved ─────────────────────────────────────────── */

/**
 * The rules every change in the binder meets, as rows rather than a bulleted
 * paragraph.
 *
 * The approval count and "a new version clears the approvals" are Gitea branch
 * protection, which this page does not edit yet — so they are stated, not
 * drawn as controls that do nothing. Whether discussions must be resolved has
 * no Gitea equivalent and takes effect straight away.
 */
function ApprovalSection({
  org,
  binder,
  settings,
  canManage,
  onChanged,
}: {
  org: string;
  binder: string;
  settings: WorkspaceSettingsPayload;
  canManage: boolean;
  onChanged: (settings: WorkspaceSettingsPayload) => void;
}) {
  const rules = settings.rules;
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleThreads(next: boolean) {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await setBinderRules(org, binder, next);
      onChanged({
        ...settings,
        rules: {
          ...rules,
          blockOnUnresolvedThreads: updated.blockOnUnresolvedThreads,
        },
      });
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Unable to change the rules."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bs-section" aria-labelledby="binder-settings-approval">
      <div className="bs-section-head">
        <h3 className="bs-section-title" id="binder-settings-approval">
          How changes are approved
        </h3>
      </div>

      {/* Worth saying loudly: a binder without this is not making the
          product's one promise. */}
      {rules.pushBlocked ? null : (
        <p className="bs-note bs-note--danger" role="alert">
          This binder&rsquo;s main branch is not protected, so a document could
          be changed without a review.
        </p>
      )}

      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="bs-panel">
        <ul className="bs-row-list">
          <li className="bs-row">
            <span className="bs-row-body">
              <span className="bs-row-name">
                Approvals needed before publishing
              </span>
            </span>
            <span className="bs-row-right bs-settings-value">
              {rules.requiredApprovals === null
                ? "Could not be read"
                : rules.requiredApprovals}
            </span>
          </li>
          <li className="bs-row">
            <span className="bs-row-body">
              <span className="bs-row-name">
                A new version clears the approvals already collected
              </span>
            </span>
            <span className="bs-row-right bs-settings-value">
              {rules.dismissStaleApprovals ? "Yes" : "No"}
            </span>
          </li>
          <li className="bs-row">
            <span className="bs-row-body">
              <label className="bs-row-name" htmlFor="binder-block-on-threads">
                Every discussion must be resolved before publishing
              </label>
            </span>
            <span className="bs-row-right bs-settings-value">
              {canManage ? (
                <input
                  id="binder-block-on-threads"
                  className="bs-checkbox"
                  type="checkbox"
                  checked={rules.blockOnUnresolvedThreads}
                  disabled={saving}
                  onChange={(event) => void toggleThreads(event.target.checked)}
                />
              ) : rules.blockOnUnresolvedThreads ? (
                "Yes"
              ) : (
                "No"
              )}
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
