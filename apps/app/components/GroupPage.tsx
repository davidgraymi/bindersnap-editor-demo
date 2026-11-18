import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { describeGroupName } from "../../../packages/utils/groupName";
import {
  addOrganizationGroupMember,
  removeOrganizationGroupMember,
} from "../api";
import { followInApp } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import { groupLevelLabel } from "../binderSettings";
import {
  organizationGroupQuery,
  organizationPeopleQuery,
  queryKeys,
} from "../data/queries";
import { formatDocumentName } from "../documentDisplay";
import { routeToPath, type AppRoute } from "../routes";
import { describeDocumentPath, describeFolder } from "../signOffPanel";
import { PersonAvatar } from "./PersonAvatar";
import { RemoveButton } from "./RemoveButton";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * One group's page: `/{org}/-/groups/{group}` (4.8).
 *
 * The question it answers is "what does this group actually approve?", which
 * used to mean opening every binder's settings. **Where it signs off** lists
 * every rule in every binder the reader can read that names the group, each a
 * link to its folder, document or binder — read live from each binder's
 * rules, never a copy. Then the binders it can use, and its people.
 *
 * Everyone in the organization reads it; only an owner changes who is in it,
 * the rule the People page already keeps.
 */
export function GroupPage({
  org,
  group,
  onNavigate,
}: {
  org: string;
  group: string;
  onNavigate: (route: AppRoute) => void;
}) {
  const queryClient = useQueryClient();
  const read = useQuery(organizationGroupQuery(org, group));
  const people = useQuery({
    ...organizationPeopleQuery(org),
    enabled: read.data?.canManage === true,
  }).data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");

  const go =
    (route: AppRoute) => (event: React.MouseEvent<HTMLAnchorElement>) =>
      followInApp(event, () => onNavigate(route));

  if (read.error) {
    return (
      <section className="docw-page">
        <div className="bs-empty not-found">
          <h1 className="bs-title">No such group</h1>
          <p>
            There is no group called {describeGroupName(group)} in this
            organization, or it is not one you can see.
          </p>
        </div>
      </section>
    );
  }
  const data = read.data;
  const name = describeGroupName(group);
  const level = data ? groupLevelLabel(data.group.access) : "";
  const writes = level === "Editor" || level === "Admin";

  const change = async (act: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    setError(null);
    try {
      await act();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.organizationGroup(org, group),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organizationPeople(org),
      });
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const peopleRoute: AppRoute = { kind: "organization", org, tab: "people" };
  const candidates = (people?.people ?? []).filter(
    (person) => !(data?.members ?? []).some((m) => m.login === person.login),
  );

  return (
    <section className="docw-page group-page">
      <nav className="page-path" aria-label="Breadcrumb">
        <ol className="page-path-list">
          <li className="page-path-step">
            <a
              className="page-path-link"
              href={routeToPath(peopleRoute)}
              onClick={go(peopleRoute)}
            >
              People
            </a>
          </li>
          <li className="page-path-step">
            <span className="page-path-sep" aria-hidden="true">
              /
            </span>
            <span className="page-path-text">Groups</span>
          </li>
          <li className="page-path-step">
            <span className="page-path-sep" aria-hidden="true">
              /
            </span>
            <span
              className="page-path-text page-path-text--current"
              aria-current="page"
            >
              {name}
            </span>
          </li>
        </ol>
      </nav>

      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title group-page-title">
            <AppIcon icon={ICON.people} size="lg" />
            {name}
          </h1>
          {data ? (
            <p className="bs-subtitle">
              {data.group.description ? `${data.group.description} · ` : ""}
              {data.members.length === 1
                ? "1 person"
                : `${data.members.length} people`}{" "}
              · {level} · a group in {formatDocumentName(org)}
            </p>
          ) : (
            <SkeletonLine width="medium" />
          )}
        </div>
      </div>

      {error ? (
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      ) : null}

      {!data ? (
        <SkeletonGroup label="Reading the group">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      ) : (
        <div className="group-page-body">
          <section className="bs-panel" aria-labelledby="group-signs-off">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title" id="group-signs-off">
                Where it signs off
              </h2>
              {data.signsOff.length > 0 ? (
                <span className="bs-section-count">{data.signsOff.length}</span>
              ) : null}
            </div>
            {data.signsOff.length === 0 ? (
              <p className="doc-rail-empty">No sign-off rule names {name}.</p>
            ) : (
              <ul className="bs-row-list">
                {data.signsOff.map((place) => {
                  const binderName = formatDocumentName(place.binder);
                  const route: AppRoute =
                    place.scope === "folder"
                      ? {
                          kind: "binder",
                          org,
                          binder: place.binder,
                          folder: place.place,
                        }
                      : place.scope === "document" && place.place
                        ? {
                            kind: "binderDocument",
                            org,
                            binder: place.binder,
                            documentPath: place.place,
                          }
                        : { kind: "binder", org, binder: place.binder };
                  const title =
                    place.scope === "folder"
                      ? describeFolder(place.place)
                      : place.scope === "document"
                        ? place.place
                          ? describeDocumentPath(place.place)
                          : "A document"
                        : place.scope === "rules"
                          ? "Any change to who signs off"
                          : "The whole binder";
                  const kind =
                    place.scope === "folder"
                      ? "Folder"
                      : place.scope === "document"
                        ? "Document"
                        : place.scope === "rules"
                          ? "The rules"
                          : "Binder";
                  const covered =
                    place.scope === "folder"
                      ? ` · ${
                          place.covers.length === 1
                            ? "1 document"
                            : `${place.covers.length} documents`
                        }${
                          place.covers.length > 0
                            ? ` · ${place.covers
                                .slice(0, 3)
                                .map((d) => describeDocumentPath(d.path))
                                .join(
                                  ", ",
                                )}${place.covers.length > 3 ? "…" : ""}`
                            : ""
                        }`
                      : "";
                  return (
                    <li key={`${place.binder}:${place.scope}:${place.place}`}>
                      <a
                        className="bs-row bs-row--tall"
                        href={routeToPath(route)}
                        onClick={go(route)}
                      >
                        <span className="bs-row-icon" aria-hidden="true">
                          <AppIcon
                            icon={
                              place.scope === "folder"
                                ? ICON.folder
                                : place.scope === "document"
                                  ? ICON.document
                                  : ICON.rules
                            }
                            size="sm"
                          />
                        </span>
                        <span className="bs-row-body">
                          <span className="bs-row-name">
                            {binderName} · {title}
                          </span>
                          <span className="bs-row-meta">
                            {kind}
                            {covered}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="bs-panel" aria-labelledby="group-binders">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title" id="group-binders">
                Binders it can use
              </h2>
            </div>
            {data.binders.length === 0 ? (
              <p className="doc-rail-empty">
                {name} is not given any binder you can see.
              </p>
            ) : (
              <ul className="bs-row-list">
                {data.binders.map((binder) => (
                  <li key={binder.name}>
                    <a
                      className="bs-row"
                      href={buildBinderUrl({ org, binder: binder.name })}
                      onClick={go({ kind: "binder", org, binder: binder.name })}
                    >
                      <span className="bs-row-icon" aria-hidden="true">
                        <AppIcon icon={ICON.binder} size="sm" />
                      </span>
                      <span className="bs-row-body">
                        <span className="bs-row-name">
                          {formatDocumentName(binder.name)}
                        </span>
                        <span className="bs-row-meta">
                          {level}
                          {binder.approver ? " · approver" : ""}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bs-panel" aria-labelledby="group-people">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title" id="group-people">
                People
              </h2>
              <span className="bs-section-count">{data.members.length}</span>
            </div>
            {data.members.length === 0 ? (
              <p className="doc-rail-empty">Nobody is in {name} yet.</p>
            ) : (
              <ul className="bs-row-list">
                {data.members.map((member) => (
                  <li className="bs-row" key={member.login}>
                    <PersonAvatar
                      person={member}
                      size="sm"
                      card={`${name} · ${level}`}
                    />
                    <span className="bs-row-body">
                      <span className="bs-row-name">
                        {member.fullName || member.login}
                      </span>
                      <span className="bs-row-meta">@{member.login}</span>
                    </span>
                    {data.canManage ? (
                      <span className="bs-row-right">
                        <RemoveButton
                          label={`Take ${member.fullName || member.login} out of ${name}`}
                          busy={busy}
                          onClick={() =>
                            void change(
                              () =>
                                removeOrganizationGroupMember(
                                  org,
                                  group,
                                  member.login,
                                ),
                              "Unable to take them out of the group.",
                            )
                          }
                        />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {data.canManage ? (
              <div className="bs-panel-foot">
                <label className="sr-only" htmlFor="group-add-person">
                  Add a person to {name}
                </label>
                <select
                  id="group-add-person"
                  className="bs-input bs-input--sm"
                  value={adding}
                  disabled={busy || candidates.length === 0}
                  onChange={(event) => setAdding(event.target.value)}
                >
                  <option value="">Choose someone…</option>
                  {candidates.map((person) => (
                    <option key={person.login} value={person.login}>
                      {person.fullName || person.login}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="bs-btn bs-btn--sm bs-btn-primary"
                  disabled={busy || adding === ""}
                  onClick={() =>
                    void change(async () => {
                      await addOrganizationGroupMember(org, group, adding);
                      setAdding("");
                    }, "Unable to add them to the group.")
                  }
                >
                  Add a person
                </button>
              </div>
            ) : null}
            <p className="signoff-foot">
              {writes
                ? "Everyone in a group that edits is a paid seat: $39 a month each, counted once. "
                : ""}
              Only an owner of {formatDocumentName(org)} changes who is in a
              group.
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
