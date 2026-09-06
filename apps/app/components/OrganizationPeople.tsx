import { useEffect, useState } from "react";

import { fetchOrganizationPeople } from "../api";
import type { OrganizationPeoplePayload } from "../../../packages/api-schema/schemas/workspaces";
import { describeTeamAccess } from "../binderSettings";
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
 * The groups are the other half. A group is a Gitea team, it carries one level,
 * and a binder adopts it — so this page is the vocabulary, and the binder's own
 * Settings tab is where it gets composed.
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
                    ? person.teams.join(" · ")
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

      <section className="binder-settings-section">
        <h2 className="doc-rail-title">Groups</h2>
        {payload.groups.length === 0 ? (
          <p style={{ color: "var(--bs-text-muted)" }}>
            No groups, or your access does not let you see them — Gitea shows an
            organization&rsquo;s teams to its owners.
          </p>
        ) : (
          <div className="docs-list">
            {payload.groups.map((group) => (
              <div className="org-person" key={group.id}>
                <span className="org-person-body">
                  <span className="docs-list-item-name">{group.name}</span>
                  <span className="docs-list-item-meta">
                    {group.description ||
                      `${group.memberCount} ${group.memberCount === 1 ? "person" : "people"}`}
                  </span>
                </span>
                {/* A Gitea team carries one unit map, so a group's level is a
                    property of the group rather than of the grant: "Quality
                    Committee" cannot be an editor in one binder and a reviewer
                    in another. The level travels with the name. */}
                <span className="doc-rail-row-note">
                  {describeTeamAccess(group.access)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="doc-rail-note">
        {payload.canManage
          ? "You own this organization. Adding people and creating groups is not in Bindersnap yet — it is done in Gitea for now."
          : "Only an organization owner can change any of this."}
      </p>
    </div>
  );
}
