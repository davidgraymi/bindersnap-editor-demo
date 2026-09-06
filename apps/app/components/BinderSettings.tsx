import { useEffect, useState } from "react";

import { fetchBinderSettings } from "../api";
import type { WorkspaceSettingsPayload } from "../../../packages/api-schema/schemas/workspaces";
import { describeBinderRules, describeTeamAccess } from "../binderSettings";
import { PersonAvatar } from "./PersonAvatar";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Who can act in this binder, and what has to be true before a policy changes.
 *
 * Read-only. Everything here is a Gitea primitive — org teams granted onto the
 * repository, and branch protection on `main` — which is what ADR 0004 means
 * by keeping permissions where the merge happens. Showing them is worth doing
 * before editing them: a customer who cannot see the rule cannot check that it
 * is the one they asked for.
 */

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

      <section className="binder-settings-section">
        <h2 className="doc-rail-title">Who can act here</h2>
        {settings.teams.length === 0 ? (
          // Either nobody is granted, or the reader cannot see the grants —
          // Gitea shows a repository's teams to its admins. Saying both is
          // honest; guessing which would not be.
          <p style={{ color: "var(--bs-text-muted)" }}>
            No teams are granted onto this binder, or your access does not let
            you see them.
          </p>
        ) : (
          settings.teams.map((team) => (
            <div className="binder-team" key={team.id}>
              <div className="binder-team-head">
                <span className="binder-team-name">{team.name}</span>
                <span className="doc-rail-row-note">
                  {describeTeamAccess(team.access)}
                </span>
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
      </section>

      {/* Said plainly rather than by disabling controls that are not there
          yet: a page that looks editable and is not is worse than one that
          says where the editing happens. */}
      <p className="doc-rail-note">
        {settings.canManage
          ? "You administer this binder. Changing its people and rules is not in Bindersnap yet — it is done in Gitea for now."
          : "Only a binder administrator can change any of this."}
      </p>
    </div>
  );
}
