import { useState } from "react";
import { Users } from "lucide-react";

import { describeGroupName } from "../../../packages/utils/groupName";
import { searchApprovers, type approverOptions } from "../binderSettings";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { RemoveButton } from "./RemoveButton";

/**
 * Choose whose approvals count: the chosen groups and people listed, and a
 * search box to add more.
 *
 * A search rather than a list of everyone, because an organization can have
 * more people than fit on a page. Shared by a binder's settings and the
 * new-binder form, so the two cannot drift apart.
 */
export function ApproverPicker({
  id,
  groups,
  people,
  options,
  disabled,
  onChange,
}: {
  id: string;
  groups: string[];
  people: string[];
  options: ReturnType<typeof approverOptions>;
  disabled: boolean;
  onChange: (next: { groups: string[]; people: string[] }) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = searchApprovers(
    options,
    query,
    { groups, people },
    describeGroupName,
  );
  const groupLabel = (group: string) =>
    group === "staff"
      ? "Everyone at the organization"
      : describeGroupName(group);

  return (
    <div className="bs-fields">
      {groups.length + people.length > 0 ? (
        <ul className="bs-row-list">
          {groups.map((group) => (
            <li className="bs-row" key={`group:${group}`}>
              <span className="bs-row-icon">
                <AppIcon icon={Users} size="sm" />
              </span>
              <span className="bs-row-body">
                <span className="bs-row-name">{groupLabel(group)}</span>
                <span className="bs-row-meta">Group</span>
              </span>
              <span className="bs-row-right">
                <RemoveButton
                  label={`Remove ${groupLabel(group)}`}
                  busy={disabled}
                  onClick={() =>
                    onChange({
                      groups: groups.filter((entry) => entry !== group),
                      people,
                    })
                  }
                />
              </span>
            </li>
          ))}
          {people.map((login) => {
            const name =
              options.people.find((person) => person.login === login)?.name ??
              login;
            return (
              <li className="bs-row" key={`person:${login}`}>
                <PersonAvatar person={{ login, fullName: name }} size="sm" />
                <span className="bs-row-body">
                  <span className="bs-row-name">{name}</span>
                  <span className="bs-row-meta">@{login}</span>
                </span>
                <span className="bs-row-right">
                  <RemoveButton
                    label={`Remove ${name}`}
                    busy={disabled}
                    onClick={() =>
                      onChange({
                        groups,
                        people: people.filter((entry) => entry !== login),
                      })
                    }
                  />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <label className="sr-only" htmlFor={id}>
        Search for a group or person who can approve
      </label>
      <input
        id={id}
        className="rev-picker-input"
        type="search"
        autoComplete="off"
        placeholder="Search groups and people…"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() === "" ? null : matches.length > 0 ? (
        <ul className="rev-picker-results">
          {matches.map((match) => (
            <li key={`${match.kind}:${match.value}`}>
              <button
                type="button"
                className="rev-picker-result"
                disabled={disabled}
                onClick={() => {
                  onChange(
                    match.kind === "group"
                      ? { groups: [...groups, match.value], people }
                      : { groups, people: [...people, match.value] },
                  );
                  setQuery("");
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
                    {match.kind === "group" ? "Group" : `@${match.login}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rev-picker-hint">
          No group, and nobody who can read this binder, matches that. To name a
          person, give them access first.
        </p>
      )}
    </div>
  );
}
