import { useEffect, useState } from "react";

import {
  fetchBinderSettings,
  fetchOrganizationPeople,
  grantBinderGroup,
  revokeBinderGroup,
} from "../api";
import type {
  OrganizationGroup,
  WorkspaceSettingsPayload,
  WorkspaceTeam,
} from "../../../packages/api-schema/schemas/workspaces";
import {
  describeBinderRules,
  describeTeamAccess,
  groupLevelLabel,
} from "../binderSettings";
import { describeGroupName } from "../../../packages/utils/groupName";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Who can act in this binder, and what has to be true before a policy changes.
 *
 * Everything here is a Gitea primitive — org teams granted onto the repository,
 * and branch protection on `main` — which is what ADR 0004 means by keeping
 * permissions where the merge happens.
 *
 * The one act this page offers is composing: adding a group the organization
 * already has, or taking one off. Creating a group, levelling it and filling it
 * happen on the organization, deliberately. **The organization owner controls
 * the vocabulary of groups; the binder admin composes them onto their binder** —
 * so a binder admin cannot create a group, change its level, or change who is
 * in it, and the worst they can do is adopt an existing group onto a binder
 * they already run.
 */

/**
 * Gitea's built-in Owners team, which reaches every binder in the organization
 * implicitly and is never granted onto one.
 *
 * It appears in the list — it really is who can act here — but neither act
 * applies to it: it cannot be added, because it is already everywhere, and it
 * cannot be taken off, because it was never put on. The API refuses both, and
 * drawing a control that has to refuse is worse than not drawing it.
 */
function isOwnersTeam(team: { name: string }): boolean {
  return team.name === "Owners";
}

interface BinderSettingsProps {
  org: string;
  binder: string;
}

export function BinderSettings({ org, binder }: BinderSettingsProps) {
  const [settings, setSettings] = useState<WorkspaceSettingsPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError(null);

    fetchBinderSettings(org, binder)
      .then((payload) => {
        if (!cancelled) setSettings(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to read this binder's settings.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  if (settings === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Reading this binder's settings">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  return (
    <div className="binder-pane">
      <section className="binder-settings-section">
        <h2 className="doc-rail-title">The rules</h2>
        {/* Said in sentences, not as a settings form somebody has to read
            backwards. This is the answer to "what stops a policy changing
            without approval", which is the product's whole claim. */}
        <ul className="binder-rule-list">
          {describeBinderRules(settings.rules).map((rule) => (
            <li className="binder-rule" key={rule}>
              {rule}
            </li>
          ))}
        </ul>
      </section>

      <BinderGroups
        org={org}
        binder={binder}
        teams={settings.teams}
        canManage={settings.canManage}
        onChanged={(teams) => setSettings({ ...settings, teams })}
      />
    </div>
  );
}

/**
 * The groups granted onto this binder, and — for its admin — the two acts that
 * change that.
 *
 * Each act also rewrites the binder's approvals whitelist, in the same request.
 * That is not tidiness: `enable_approvals_whitelist` is what makes a free
 * reviewer's approval count, and a group granted here but missing from the
 * whitelist has its members' approvals recorded, displayed, and satisfying
 * nothing — a failure with no error message anywhere.
 */
function BinderGroups({
  org,
  binder,
  teams,
  canManage,
  onChanged,
}: {
  org: string;
  binder: string;
  teams: WorkspaceTeam[];
  canManage: boolean;
  onChanged: (teams: WorkspaceTeam[]) => void;
}) {
  const [available, setAvailable] = useState<OrganizationGroup[] | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Only an admin can compose, so only an admin needs the picker. Reading
    // the organization's groups costs a call, and a reader who cannot use it
    // should not pay for it.
    if (!canManage) return;

    let cancelled = false;
    fetchOrganizationPeople(org)
      .then((payload) => {
        if (!cancelled) setAvailable(payload.groups);
      })
      // Losing the picker costs the button, not the page: the list of who can
      // act here is still true and is the thing somebody came to read.
      .catch(() => {
        if (!cancelled) setAvailable([]);
      });

    return () => {
      cancelled = true;
    };
  }, [org, canManage]);

  const granted = new Set(teams.map((team) => team.name.toLowerCase()));
  const candidates = (available ?? []).filter(
    (group) => !granted.has(group.name.toLowerCase()) && !isOwnersTeam(group),
  );

  async function run(act: () => Promise<{ teams: WorkspaceTeam[] }>) {
    setBusy(true);
    setNotice(null);
    try {
      onChanged((await act()).teams);
    } catch (err: unknown) {
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
      <h2 className="doc-rail-title">Who can act here</h2>

      {notice ? <p className="app-inline-error">{notice}</p> : null}

      {teams.length === 0 ? (
        // Either nobody is granted, or the reader cannot see the grants —
        // Gitea shows a repository's teams to its admins. Saying both is
        // honest; guessing which would not be.
        <p style={{ color: "var(--bs-text-muted)" }}>
          No groups are granted onto this binder, or your access does not let
          you see them.
        </p>
      ) : (
        teams.map((team) => (
          <div className="binder-team" key={team.id}>
            <div className="binder-team-head">
              <span className="binder-team-name">
                {describeGroupName(team.name)}
                <span className="org-group-level">
                  {groupLevelLabel(team.access)}
                </span>
              </span>
              <span className="doc-rail-row-note">
                {describeTeamAccess(team.access)}
              </span>
              {canManage && !isOwnersTeam(team) ? (
                <button
                  type="button"
                  className="bs-btn bs-btn-secondary bs-btn--sm"
                  disabled={busy}
                  onClick={() =>
                    run(() => revokeBinderGroup(org, binder, team.name))
                  }
                >
                  Remove from this binder
                </button>
              ) : null}
            </div>
            {team.description ? (
              <p className="doc-rail-note">{team.description}</p>
            ) : null}
            {team.members.length === 0 ? (
              <p className="doc-rail-note">Nobody yet.</p>
            ) : (
              <div className="binder-team-members">
                {team.members.map((member) => (
                  <span className="binder-team-member" key={member.login}>
                    <PersonAvatar person={member} size="sm" />
                    {member.fullName || member.login}
                  </span>
                ))}
              </div>
            )}
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
              void run(() => grantBinderGroup(org, binder, group));
            }}
          >
            Add
          </button>
        </div>
      ) : null}

      {/* A group is composed here and made on the organization, and saying so
          is what stops somebody hunting for a "new group" button that would
          have to refuse them. */}
      <p className="doc-rail-note">
        {canManage
          ? "A group carries one level everywhere it is used, so its level and its people are set on the organization. Changing the binder's rules is not in Bindersnap yet — it is done in Gitea for now."
          : "Only a binder administrator can change any of this."}
      </p>
    </section>
  );
}
