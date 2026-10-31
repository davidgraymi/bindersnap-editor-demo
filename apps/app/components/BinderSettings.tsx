import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  FileText,
  Folder,
  Library,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useIsReadOnly } from "../readOnlyContext";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

import {
  addBinderPerson,
  describeBinder,
  fetchBinderPeople,
  grantBinderGroup,
  proposeBinderSignOff,
  removeBinderPerson,
  renameBinder,
  revokeBinderGroup,
  setBinderPersonLevel,
  setBinderRules,
  setBinderVisibility,
  deleteBinder,
} from "../api";
import {
  binderPeopleQuery,
  binderQuery,
  binderSettingsQuery,
  organizationPeopleQuery,
  queryKeys,
} from "../data/queries";
import type {
  BinderPeoplePayload,
  BinderPerson,
  OrganizationGroup,
  SignOffDocumentView,
  SignOffRuleView,
  WorkspaceSettingsPayload,
} from "../../../packages/api-schema/schemas/workspaces";
import {
  approverOptions,
  countChosenApprovers,
  describeApprovers,
  describeBinderGroup,
  describeMembers,
  GROUP_LEVELS,
  groupLevelLabel,
  approverReach,
  isAnyBinderRoleTeam,
  isBinderRoleTeam,
  noApproversNote,
  parseApprovalCount,
  searchMembers,
  unreachableApprovalsNote,
  type ApproversView,
  type MemberMatch,
} from "../binderSettings";
import { ApproverPicker } from "./ApproverPicker";
import { FloatingResults } from "./FloatingResults";
import { RemoveButton } from "./RemoveButton";
import { formatDocumentName } from "../documentDisplay";
import { describeGroupName } from "../../../packages/utils/groupName";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { SettingsGroup } from "./SettingsGroup";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * How this binder is governed, in three tabs: General, People & access, and
 * Approvals.
 *
 * **Three tabs, because one scroll hid the point of the page.** On one page
 * the approval rules — the product's one promise — sat under the name form,
 * the visibility choice, every person and every group, and an empty-state
 * essay about sign-off rules. An owner of the product could not find them.
 * The tabs are the questions somebody arrives with: what is it called, who is
 * in it, and what has to happen before a change is published. Each tab has
 * one name and no second heading saying it again.
 *
 * **Approvals is one table.** The binder's approvers and its sign-off rules
 * answer the same question — who has to approve what — so they are rows of
 * one table, Rule · Who approves · Approvals required, the way GitLab lists a
 * project's approval rules. How many and who are on the same row, because
 * they are one rule.
 *
 * **People & access is one list.** The groups granted here and the people
 * added one by one, with one search to add either. Whether the whole
 * organization can read it is one switch above the list.
 */

export type BinderSettingsSection = "general" | "access" | "approvals";

const SECTIONS: ReadonlyArray<{ id: BinderSettingsSection; label: string }> = [
  { id: "general", label: "General" },
  // The organization's word for the same question, on its own tab.
  { id: "access", label: "People & access" },
  { id: "approvals", label: "Approvals" },
];

interface BinderSettingsProps {
  org: string;
  binder: string;
  /** The tab on show: `/-/settings`, `/-/settings/people`, `/-/settings/approvals`. */
  section: BinderSettingsSection;
  onSection: (section: BinderSettingsSection) => void;
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
  /** The binder is gone; leave its pages. */
  onDeleted?: () => void;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

export function BinderSettings({
  org,
  binder,
  section,
  onSection,
  onRenamed,
  onDescribed,
  onOpenChange,
  onDeleted,
}: BinderSettingsProps) {
  // The same fold every other editable surface uses: a delinquent organization
  // draws no controls, by the one flag that already decides whether controls
  // exist.
  const isReadOnly = useIsReadOnly();
  const queryClient = useQueryClient();
  const settingsRead = useQuery(binderSettingsQuery(org, binder));
  const peopleRead = useQuery(binderPeopleQuery(org, binder));
  // The description is a nicety on this page, not its point: a binder whose
  // overview cannot be read still has settings to change.
  const overviewRead = useQuery(binderQuery(org, binder));
  const settings: WorkspaceSettingsPayload | null = settingsRead.data ?? null;
  const people: BinderPeoplePayload | null = peopleRead.data ?? null;
  const description: string | null = overviewRead.data
    ? (overviewRead.data.workspace.description ?? "")
    : overviewRead.isError
      ? ""
      : null;
  const failure = settingsRead.error ?? peopleRead.error;
  const error = failure
    ? errorMessage(failure, "Unable to read this binder's settings.")
    : null;

  /**
   * The organization's list of binders shows each one's name, description
   * and whether it is open — so a rename, a deletion or a change of who can
   * read it is read again there too.
   */
  const refreshOrganization = () =>
    void queryClient.invalidateQueries({
      queryKey: queryKeys.organizationBinders(org),
    });

  /** A write answers with the new state; it becomes what every reader sees. */
  const setPeople = (next: BinderPeoplePayload) => {
    queryClient.setQueryData(queryKeys.binderPeople(org, binder), next);
    refreshOrganization();
  };
  const setSettings = (next: WorkspaceSettingsPayload) =>
    queryClient.setQueryData(queryKeys.binderSettings(org, binder), next);

  const loaded = settings !== null && people !== null && description !== null;

  const tabs = (
    <nav
      className="doc-tabs bs-settings-tabs"
      role="tablist"
      aria-label="Settings"
    >
      {SECTIONS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          className={`doc-tab${section === entry.id ? " doc-tab--active" : ""}`}
          aria-selected={section === entry.id}
          onClick={() => onSection(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </nav>
  );

  if (error) {
    return (
      <div className="binder-pane bs-settings bs-settings--tabbed">
        {tabs}
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="binder-pane bs-settings bs-settings--tabbed">
        {tabs}
        <SkeletonGroup label="Reading this binder's settings">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const canManage = settings.canManage && !isReadOnly;
  const canManagePeople = people.canManage && !isReadOnly;
  const managing = section === "access" ? canManagePeople : canManage;

  return (
    <div className="binder-pane bs-settings bs-settings--tabbed">
      {tabs}

      {/* Said once, at the top, rather than as a missing control on every
          row below. */}
      {managing ? null : (
        <p className="bs-section-note">
          Only a binder administrator can change these settings.
        </p>
      )}

      {section === "access" ? (
        <AccessTab
          org={org}
          binder={binder}
          payload={people}
          canManage={canManagePeople}
          onChanged={setPeople}
        />
      ) : section === "approvals" ? (
        <ApprovalsTab
          org={org}
          binder={binder}
          settings={settings}
          canManage={canManage}
          onChanged={setSettings}
          onOpenChange={onOpenChange}
        />
      ) : (
        <>
          {canManage ? (
            <NameAndDescription
              org={org}
              binder={binder}
              description={description}
              onRenamed={(workspace) => {
                refreshOrganization();
                onRenamed?.(workspace);
              }}
              onDescribed={(next) => {
                queryClient.setQueryData(
                  binderQuery(org, binder).queryKey,
                  (overview) =>
                    overview && {
                      ...overview,
                      workspace: { ...overview.workspace, description: next },
                    },
                );
                onDescribed?.();
              }}
            />
          ) : null}

          {settings.canDelete && !isReadOnly ? (
            <SettingsGroup
              id="binder-settings-delete"
              title="Delete this binder"
              note="Permanent. Only an owner of the organization can do this."
            >
              <DeleteBinder
                org={org}
                binder={binder}
                onDeleted={() => {
                  refreshOrganization();
                  onDeleted?.();
                }}
              />
            </SettingsGroup>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Deleting the binder — the one act here that loses the record.
 *
 * Everything else on this page is reversible, and everything in the binder is
 * evidence: every version, who approved it, what was discussed. So the page
 * says that plainly, points at the audit packets first, and asks for the name
 * typed out, the way Gitea confirms the same act.
 */
function DeleteBinder({
  org,
  binder,
  onDeleted,
}: {
  org: string;
  binder: string;
  onDeleted?: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmed = confirm.trim().toLowerCase() === binder.toLowerCase();

  return (
    <form
      className="bs-fields"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!confirmed) return;
        setDeleting(true);
        setNotice(null);
        try {
          await deleteBinder(org, binder, confirm.trim());
          onDeleted?.();
        } catch (err) {
          setNotice(errorMessage(err, "Unable to delete this binder."));
          setDeleting(false);
        }
      }}
    >
      <p className="bs-section-note">
        Every document in it goes, with every version, approval and discussion —
        the whole record, with no way to restore it. If a surveyor may ever ask
        about these documents, download each one&rsquo;s audit packet first.
      </p>
      <div className="bs-field">
        <label className="bs-field-label" htmlFor="binder-delete-confirm">
          Type <strong>{binder}</strong> to confirm
        </label>
        <input
          className="bs-input bs-input--sm"
          id="binder-delete-confirm"
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
          {deleting ? "Deleting…" : "Delete this binder"}
        </button>
      </div>
    </form>
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
            className="bs-input bs-input--sm"
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
            className="bs-input bs-input--sm bs-settings-description"
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

/* ── People & access ──────────────────────────────────────────────────── */

/**
 * The organization's Owners team reaches every binder implicitly rather than
 * by a grant, so neither adding nor removing applies to it.
 */
function isOwnersTeam(team: { name: string }): boolean {
  return team.name === "Owners";
}

/** Everyone in the organization: the switch, never a row or a pick. */
function isEveryoneGroup(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "everyone" || lower === "staff";
}

/**
 * The rest of what is true of somebody added one by one: the groups here they
 * are also in. Somebody here *only* through a group is not a row of their own
 * — their group's row names them.
 */
function describeAlsoIn(person: BinderPerson): string | null {
  if (person.groups.length === 0) return null;
  return `Also in ${person.groups.map(describeGroupName).join(", ")}`;
}

/**
 * Who can get into this binder, and what they can do there.
 *
 * **One switch, one list, one search.** It was a pair of radio cards ("Who can
 * see this binder"), a People list and a Groups list, with three ways to add.
 * The radio pair was one yes-or-no drawn as two choices, under a name that
 * undersold it — the people below it edit and administer, not only see. And
 * the two lists showed everyone twice: once as a person "through" a group,
 * and again inside the group.
 */
function AccessTab({
  org,
  binder,
  payload,
  canManage,
  onChanged,
}: {
  org: string;
  binder: string;
  payload: BinderPeoplePayload;
  canManage: boolean;
  onChanged: (payload: BinderPeoplePayload) => void;
}) {
  const orgDisplayName = useOrganizationDisplayName(org);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Only an admin can add, so only an admin pays for the organization's
  // groups. Losing them costs the groups in the search, not the page.
  const orgRead = useQuery({
    ...organizationPeopleQuery(org),
    enabled: canManage,
  });

  async function run(act: () => Promise<BinderPeoplePayload>) {
    setBusy(true);
    setNotice(null);
    try {
      onChanged(await act());
    } catch (err: unknown) {
      // On the tab, not the page. A refusal here is a sentence worth
      // reading — "she is here through Quality Committee, and that reaches
      // three binders" — and replacing the list with it would hide the row.
      setNotice(errorMessage(err, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  const open = payload.openToOrganization;
  const groups = payload.groups.filter(
    (group) => !isBinderRoleTeam(binder, group.name),
  );
  const individuals = payload.people.filter((person) => person.individual);

  const granted = new Set(groups.map((group) => group.name.toLowerCase()));
  const groupCandidates = (orgRead.data?.groups ?? []).filter(
    (group) =>
      !granted.has(group.name.toLowerCase()) &&
      !isOwnersTeam(group) &&
      !isEveryoneGroup(group.name) &&
      !isBinderRoleTeam(binder, group.name) &&
      !isAnyBinderRoleTeam(group),
  );
  // Somebody here through a group is still offered: adding them on their own
  // is the one way to give one member of a group more in this binder.
  const added = new Set(
    individuals.map((person) => person.login.toLowerCase()),
  );
  const peopleCandidates = payload.organizationMembers.filter(
    (person) => !added.has(person.login.toLowerCase()),
  );

  return (
    <>
      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="bs-panel">
        <ul className="bs-row-list">
          <li className="bs-row">
            <span className="bs-row-icon">
              <AppIcon icon={Building2} size="md" />
            </span>
            <span className="bs-row-body">
              <label className="bs-row-name" htmlFor="binder-open">
                Open to everyone at {orgDisplayName}
              </label>
              <span className="bs-row-meta">
                {open
                  ? "Everyone in the organization can read it and comment on changes."
                  : "Only the people and groups below can see it."}
              </span>
            </span>
            <span className="bs-row-right bs-settings-value">
              {canManage ? (
                <input
                  id="binder-open"
                  className="bs-checkbox"
                  type="checkbox"
                  checked={open}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.checked;
                    void run(() => setBinderVisibility(org, binder, next));
                  }}
                />
              ) : open ? (
                "Yes"
              ) : (
                "No"
              )}
            </span>
          </li>
        </ul>
      </div>

      <div className="bs-panel">
        {groups.length + individuals.length === 0 ? (
          <div className="bs-empty">
            <p>
              Nobody has been added, or your access does not let you see who
              has.
            </p>
          </div>
        ) : (
          <ul className="bs-row-list" aria-label="People and groups">
            {groups.map((group) => {
              const name = describeGroupName(group.name);
              return (
                <li className="bs-row" key={`group:${group.id}`}>
                  <span className="bs-row-icon">
                    <AppIcon icon={Users} size="md" />
                  </span>
                  <span className="bs-row-body">
                    <span className="bs-row-name">{name}</span>
                    {/* A group with nobody in it grants nothing and, named by
                        a rule, waits for nobody. Said on its row. */}
                    <span
                      className={`bs-row-meta${group.members.length === 0 ? " bs-row-meta--warn" : ""}`}
                    >
                      {describeMembers(group.members)}
                    </span>
                  </span>
                  <span className="bs-row-right">
                    <span>{groupLevelLabel(group.access)}</span>
                    {canManage && !isOwnersTeam(group) ? (
                      <RemoveButton
                        label={`Take ${name} out of this binder`}
                        busy={busy}
                        onClick={() =>
                          void run(async () => {
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
            {individuals.map((person) => (
              <PersonRow
                key={`person:${person.login}`}
                person={person}
                canManage={canManage}
                busy={busy}
                onSetLevel={(level) =>
                  void run(() =>
                    setBinderPersonLevel(org, binder, person.login, level),
                  )
                }
                onRemove={() =>
                  void run(() => removeBinderPerson(org, binder, person.login))
                }
              />
            ))}
          </ul>
        )}
        {canManage ? (
          <AddMember
            groups={groupCandidates}
            people={peopleCandidates}
            busy={busy}
            onAddGroup={(group) =>
              void run(async () => {
                await grantBinderGroup(org, binder, group);
                return fetchBinderPeople(org, binder);
              })
            }
            onAddPerson={(username, level) =>
              void run(() => addBinderPerson(org, binder, username, level))
            }
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * Somebody added to this binder on their own, and what they can do here.
 *
 * A role is a dropdown rather than a dialog: changing it is one Gitea call and
 * reversible.
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
  const also = describeAlsoIn(person);

  return (
    <li className="bs-row">
      <PersonAvatar person={person} size="sm" />
      <span className="bs-row-body">
        <span className="bs-row-name">{name}</span>
        {also ? <span className="bs-row-meta">{also}</span> : null}
      </span>
      <span className="bs-row-right">
        {canManage ? (
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

/**
 * The one way in: search the organization's groups and people, pick one,
 * then Add.
 *
 * **A group brings its own level.** A group is one object across every binder
 * it reaches, so it is added at the level it has; only a person is given one
 * here.
 */
function AddMember({
  groups,
  people,
  busy,
  onAddGroup,
  onAddPerson,
}: {
  groups: OrganizationGroup[];
  people: Array<{ login: string; fullName: string }>;
  busy: boolean;
  onAddGroup: (group: string) => void;
  onAddPerson: (username: string, level: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<MemberMatch | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [level, setLevel] = useState("reviewer");
  const matches = searchMembers(groups, people, query, describeGroupName);

  if (chosen) {
    return (
      <div className="bs-panel-foot">
        {chosen.kind === "group" ? (
          <AppIcon icon={Users} size="sm" />
        ) : (
          <PersonAvatar
            person={{ login: chosen.login, fullName: chosen.label }}
            size="sm"
          />
        )}
        <span className="bs-panel-foot-note bs-settings-chosen">
          {chosen.label}
        </span>
        {chosen.kind === "person" ? (
          <select
            className="bs-input bs-input--sm bs-settings-level"
            value={level}
            disabled={busy}
            onChange={(event) => setLevel(event.target.value)}
            aria-label={`What ${chosen.label} can do here`}
          >
            {GROUP_LEVELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <span>{groupLevelLabel(chosen.access)}</span>
        )}
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn-primary"
          disabled={busy}
          onClick={() => {
            if (chosen.kind === "group") onAddGroup(chosen.name);
            else onAddPerson(chosen.login, level);
            setChosen(null);
            setQuery("");
          }}
        >
          Add
        </button>
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn--quiet"
          disabled={busy}
          onClick={() => setChosen(null)}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="bs-panel-foot bs-settings-adder">
      <input
        ref={inputRef}
        className="rev-picker-input"
        type="search"
        autoComplete="off"
        placeholder="Add people or groups…"
        aria-label="Add people or groups to this binder"
        value={query}
        disabled={busy}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          // A search box clears itself on Escape, and that change would open
          // the list again. Escape closes the list; the words stay.
          if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <FloatingResults anchor={inputRef} onClose={() => setOpen(false)}>
          {matches.length > 0 ? (
            <ul className="rev-picker-results">
              {matches.map((match) => (
                <li
                  key={
                    match.kind === "group"
                      ? `group:${match.name}`
                      : `person:${match.login}`
                  }
                >
                  <button
                    type="button"
                    className="rev-picker-result"
                    onClick={() => {
                      setChosen(match);
                      setOpen(false);
                    }}
                  >
                    {match.kind === "group" ? (
                      <AppIcon icon={Users} size="sm" />
                    ) : (
                      <PersonAvatar
                        person={{ login: match.login, fullName: match.label }}
                        size="sm"
                      />
                    )}
                    <span className="rev-picker-identity">
                      <span className="rev-picker-name">{match.label}</span>
                      <span className="rev-picker-login">
                        {match.kind === "group"
                          ? `Group · ${groupLevelLabel(match.access)}`
                          : `@${match.login}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rev-picker-hint">
              {query === ""
                ? "Everybody in the organization is already here."
                : "Nothing matches that."}
            </p>
          )}
        </FloatingResults>
      ) : null}
    </div>
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

/* ── The approval count ───────────────────────────────────────────────── */

/**
 * The approval count, typed.
 *
 * A number field rather than a menu, because the count is whatever the
 * binder's administrator says it is — a board of twelve that signs off on
 * everything needs twelve, and Gitea stores any number. It saves when the
 * field is left or Enter is pressed, not on every keystroke, so typing "12"
 * never briefly asks for one approval. Escape puts it back.
 */
function ApprovalCountField({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (count: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const count = parseApprovalCount(text);

  function commit() {
    if (count === null) {
      setText(String(value));
      return;
    }
    if (count !== value) onCommit(count);
  }

  return (
    <input
      id="binder-approvals"
      aria-label="Approvals required"
      className="bs-input bs-input--sm bs-settings-count"
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      value={text}
      disabled={disabled}
      aria-invalid={count === null}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          setText(String(value));
        }
      }}
    />
  );
}

/* ── Approvals ────────────────────────────────────────────────────────── */

/**
 * What has to happen before a change is published: one table of rules, then
 * the two conditions every publish meets.
 *
 * **Two kinds of row, one question.** The first row is the binder's own rule
 * — how many approvals every change needs, and whose count — kept in the
 * binder's protection and saved the moment it changes. The rows under it are
 * sign-off rules, one per folder or document, kept in the binder's CODEOWNERS
 * file: **changing them is itself a change to the binder**, so they are
 * drafted here and "Propose these rules" opens a change request for them. A
 * customer buying "nothing changes without approval" who found the rules could
 * be changed silently would have found the hole in the product.
 *
 * **No state pill on a rule.** A rule on this page *is* the binder's rule.
 * What is worth saying — that the binder is not enforcing them, or that one is
 * holding nothing — is said where it applies.
 */
function ApprovalsTab({
  org,
  binder,
  settings,
  canManage,
  onChanged,
  onOpenChange,
}: {
  org: string;
  binder: string;
  settings: WorkspaceSettingsPayload;
  canManage: boolean;
  onChanged: (settings: WorkspaceSettingsPayload) => void;
  onOpenChange: (changeNumber: number) => void;
}) {
  const rules = settings.rules;
  const signOff = settings.signOff;
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftRule[]>(() =>
    signOff.rules.map(draftFrom),
  );
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTarget, setNewTarget] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [proposing, setProposing] = useState(false);
  const [opened, setOpened] = useState<number | null>(null);

  const pending = signOff.pendingChange;
  const changed = ruleSignature(draft) !== ruleSignature(signOff.rules);
  // Two open at once would leave competing versions of the rules in review,
  // and whichever was published last would silently win.
  const drafting = canManage && pending === null && opened === null;

  /** The binder's own rules: saved straight away, answered with the new state. */
  async function change(next: {
    blockOnUnresolvedThreads?: boolean;
    requiredApprovals?: number;
    dismissStaleApprovals?: boolean;
    approvers?: { groups: string[]; people: string[] };
  }): Promise<boolean> {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await setBinderRules(org, binder, next);
      onChanged({
        ...settings,
        rules: {
          ...rules,
          blockOnUnresolvedThreads: updated.blockOnUnresolvedThreads,
          requiredApprovals:
            updated.requiredApprovals ?? rules.requiredApprovals,
          dismissStaleApprovals:
            updated.dismissStaleApprovals ?? rules.dismissStaleApprovals,
          approvers: updated.approvers ?? rules.approvers,
        },
      });
      return true;
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Unable to change the rules."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function propose() {
    setProposing(true);
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
      setEditingRule(null);
      setOpened(result.changeNumber);
    } catch (err: unknown) {
      setNotice(errorMessage(err, "Unable to propose these rules."));
    } finally {
      setProposing(false);
    }
  }

  const update = (key: string, next: Partial<SignOffRuleView>) =>
    setDraft(
      draft.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)),
    );

  return (
    <>
      {/* Worth saying loudly: a binder without these is not making the
          product's one promise. */}
      {rules.pushBlocked ? null : (
        <p className="bs-note bs-note--danger" role="alert">
          This binder&rsquo;s main branch is not protected, so a document could
          be changed without a review.
        </p>
      )}
      {signOff.enforced || signOff.rules.length === 0 ? null : (
        <p className="bs-note bs-note--danger" role="alert">
          This binder is not holding changes for its sign-off rules, so a change
          can be published without them. Ask an administrator to check the
          binder&rsquo;s protection rules.
        </p>
      )}
      {notice ? (
        <p className="bs-note bs-note--danger" role="alert">
          {notice}
        </p>
      ) : null}

      <div className="bs-panel" id="sign-off">
        <table className="rev-rules-table bs-settings-rules">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Who approves</th>
              <th scope="col" className="bs-settings-rules-count">
                Approvals required
              </th>
            </tr>
          </thead>
          <tbody>
            <EveryChangeRow
              org={org}
              binder={binder}
              settings={settings}
              canManage={canManage}
              saving={saving}
              onCount={(count) => void change({ requiredApprovals: count })}
              onApprovers={(approvers) => change({ approvers })}
            />
            {draft.map((rule) =>
              editingRule === rule.key && drafting ? (
                <tr key={rule.key}>
                  <td colSpan={3}>
                    <div className="bs-settings-rules-edit">
                      <RulePickers
                        target={targetValue(rule)}
                        team={rule.teams[0] ?? ""}
                        folders={signOff.folders}
                        documents={signOff.documents}
                        groups={signOff.groups}
                        busy={proposing}
                        current={rule}
                        onTarget={(value) =>
                          update(rule.key, parseTargetValue(value))
                        }
                        onTeam={(value) =>
                          update(rule.key, {
                            teams: value === "" ? [] : [value],
                          })
                        }
                      />
                      <button
                        type="button"
                        className="bs-btn bs-btn--sm bs-btn-secondary"
                        onClick={() => setEditingRule(null)}
                      >
                        Done
                      </button>
                    </div>
                  </td>
                </tr>
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
                          disabled={proposing}
                          aria-label={`Change the rule for ${describeTarget(rule, signOff.documents)}`}
                          title="Change"
                          onClick={() => setEditingRule(rule.key)}
                        >
                          <AppIcon icon={Pencil} size="sm" />
                        </button>
                        <RemoveButton
                          label={`Remove the rule for ${describeTarget(rule, signOff.documents)}`}
                          busy={proposing}
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
              <tr key={`unreadable-${line.line}`}>
                <td colSpan={3}>
                  <span className="bs-settings-rules-target bs-row-meta--warn">
                    <AppIcon icon={AlertTriangle} size="sm" />
                    <span>
                      A rule that cannot be read, and enforces nothing:{" "}
                      <code className="bs-filename">{line.text}</code>
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {drafting ? (
          adding ? (
            <div className="bs-panel-foot">
              <RulePickers
                target={newTarget}
                team={newTeam}
                folders={signOff.folders}
                documents={signOff.documents}
                groups={signOff.groups}
                busy={proposing}
                onTarget={setNewTarget}
                onTeam={setNewTeam}
              />
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-secondary"
                aria-label="Add this rule"
                disabled={proposing || newTarget === "" || newTeam === ""}
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
                  setAdding(false);
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                onClick={() => {
                  setAdding(false);
                  setNewTarget("");
                  setNewTeam("");
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="bs-panel-foot">
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                onClick={() => setAdding(true)}
              >
                <AppIcon icon={Plus} size="sm" />
                Add a rule for a folder or document
              </button>
            </div>
          )
        ) : null}

        {/* Why the document picker is short, when it is. A document rule is
            keyed on the identity in the filename, so a binder filed before
            that existed offers no documents at all. */}
        {drafting &&
        adding &&
        signOff.documents.length === 0 &&
        signOff.unnameableDocuments > 0 ? (
          <div className="bs-panel-foot">
            {signOff.unnameableDocuments === 1
              ? "The document in this binder was filed before Bindersnap tracked documents individually, so a rule can only cover its folder."
              : `The ${signOff.unnameableDocuments} documents in this binder were filed before Bindersnap tracked documents individually, so a rule can only cover their folders.`}
          </div>
        ) : null}

        {drafting && changed ? (
          <div className="bs-panel-foot">
            <span className="bs-panel-foot-note">
              Changing a folder or document rule is itself a change to the
              binder, so it goes through the same approval your documents do.
            </span>
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn--quiet"
              disabled={proposing}
              onClick={() => {
                setEditingRule(null);
                setDraft(signOff.rules.map(draftFrom));
              }}
            >
              Undo
            </button>
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn-primary"
              disabled={proposing}
              onClick={() => void propose()}
            >
              {proposing ? "Opening a change…" : "Propose these rules"}
            </button>
          </div>
        ) : canManage && (opened ?? pending) !== null ? (
          <div className="bs-panel-foot">
            <span className="bs-panel-foot-note">
              {opened !== null
                ? "We opened a change request for these rules. Nothing takes effect until it is published."
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

      <section
        className="bs-section"
        aria-labelledby="binder-before-publishing"
      >
        <div className="bs-section-head">
          <h3 className="bs-section-title" id="binder-before-publishing">
            Before publishing
          </h3>
        </div>
        <div className="bs-panel">
          <ul className="bs-row-list">
            <li className="bs-row">
              <span className="bs-row-body">
                <label className="bs-row-name" htmlFor="binder-dismiss-stale">
                  Ask approvers again after the change is edited
                </label>
                {/* The consequence either way, since both are defensible and
                    the record reads differently under each. */}
                <span className="bs-row-meta">
                  {rules.dismissStaleApprovals
                    ? "An edit clears the approvals already given, so every approval is for exactly what was published."
                    : "Approvals stand when a change is edited afterwards. Approvers are not asked to look again."}
                </span>
              </span>
              <span className="bs-row-right bs-settings-value">
                {canManage ? (
                  <input
                    id="binder-dismiss-stale"
                    className="bs-checkbox"
                    type="checkbox"
                    checked={rules.dismissStaleApprovals}
                    disabled={saving}
                    onChange={(event) =>
                      void change({
                        dismissStaleApprovals: event.target.checked,
                      })
                    }
                  />
                ) : rules.dismissStaleApprovals ? (
                  "Yes"
                ) : (
                  "No"
                )}
              </span>
            </li>
            <li className="bs-row">
              <span className="bs-row-body">
                <label
                  className="bs-row-name"
                  htmlFor="binder-block-on-threads"
                >
                  Every discussion must be resolved
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
                    onChange={(event) =>
                      void change({
                        blockOnUnresolvedThreads: event.target.checked,
                      })
                    }
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
    </>
  );
}

/**
 * The binder's own rule, as the table's first row: who approves every change,
 * and how many of them must.
 *
 * **Who and how many are one row** because they are one rule — "any 3 of the
 * Board". The list is chosen with a search over the whole organization in
 * which only those who can read the binder can be picked (Gitea counts nobody
 * else), and saved as one change rather than per pick: "the Board" then "and
 * Dr. Okafor" written one at a time would leave the binder, for a moment,
 * counting the Board alone.
 */
function EveryChangeRow({
  org,
  binder,
  settings,
  canManage,
  saving,
  onCount,
  onApprovers,
}: {
  org: string;
  binder: string;
  settings: WorkspaceSettingsPayload;
  canManage: boolean;
  saving: boolean;
  onCount: (count: number) => void;
  onApprovers: (approvers: {
    groups: string[];
    people: string[];
  }) => Promise<boolean>;
}) {
  const rules = settings.rules;
  const approvers: ApproversView | null = rules.approvers;
  const orgPeople = useQuery(organizationPeopleQuery(org)).data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ groups: string[]; people: string[] }>({
    groups: [],
    people: [],
  });

  const options = approverOptions(
    (orgPeople?.groups ?? []).map((group) => group.name),
    orgPeople?.people ?? [],
  );
  const canPick = approverReach(
    settings.teams,
    (orgPeople?.people ?? [])
      .filter((person) => person.isOwner)
      .map((person) => person.login),
  );

  const groupName = (name: string) =>
    describeBinderGroup(binder, name, describeGroupName);

  const required = rules.requiredApprovals;
  const warning =
    required === null
      ? null
      : (noApproversNote(required, approvers) ??
        unreachableApprovalsNote(
          required,
          countChosenApprovers(approvers, settings.teams),
        ));
  const chosen = approvers
    ? approvers.groups.length + approvers.people.length
    : 0;

  return (
    <tr>
      <td>
        <span className="bs-settings-rules-target">
          <AppIcon icon={Library} size="sm" />
          <span>
            <span className="rev-rules-name">Every change</span>
            <span className="rev-rules-owners">
              {required === 0
                ? "Publishes without an approval"
                : "The author never counts"}
            </span>
          </span>
        </span>
      </td>
      <td>
        <div className="bs-settings-rules-who">
          <span id="binder-approvers">
            {approvers === null
              ? "Could not be read"
              : describeApprovers(approvers, options.people, groupName)}
          </span>
          {canManage && approvers !== null && !editing ? (
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn-secondary"
              aria-label="Change who approves changes"
              onClick={() => {
                setDraft({
                  groups: [...approvers.groups],
                  people: [...approvers.people],
                });
                setEditing(true);
              }}
            >
              Edit
            </button>
          ) : null}
        </div>
        {required !== null && required > 1 && chosen > 1 ? (
          <span className="rev-rules-owners">
            Any {required} of them together, not {required} from each group.
          </span>
        ) : null}
        {warning ? (
          <span className="rev-rules-owners bs-row-meta--warning" role="status">
            {warning}
          </span>
        ) : null}
        {editing ? (
          <div className="bs-settings-rules-picker">
            <ApproverPicker
              id="binder-approver-search"
              groups={draft.groups}
              people={draft.people}
              options={options}
              canPick={canPick}
              groupName={groupName}
              disabled={saving}
              onChange={setDraft}
            />
            <div className="bs-field-row">
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-primary"
                disabled={saving}
                onClick={() =>
                  void onApprovers(draft).then((saved) => {
                    if (saved) setEditing(false);
                  })
                }
              >
                Save
              </button>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </td>
      <td className="rev-rules-count bs-settings-rules-count">
        {required === null ? (
          "Could not be read"
        ) : canManage ? (
          <ApprovalCountField
            value={required}
            disabled={saving}
            onCommit={onCount}
          />
        ) : (
          required
        )}
      </td>
    </tr>
  );
}

/** A sign-off rule, as a row of the table: what it covers, who signs it off. */
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
    <tr>
      <td>
        <span className="bs-settings-rules-target">
          <AppIcon icon={scopeIcon(rule.scope)} size="sm" />
          <span className="rev-rules-name">
            {describeTarget(rule, documents)}
          </span>
        </span>
      </td>
      <td>
        <div className="bs-settings-rules-who">
          <span className={owners.holdingNothing ? "bs-row-meta--warn" : ""}>
            {owners.text}
          </span>
          {actions}
        </div>
      </td>
      {/* Gitea's code-owner gate asks one owner per rule; a count is not
          something CODEOWNERS can say yet. */}
      <td className="rev-rules-count bs-settings-rules-count">1</td>
    </tr>
  );
}
