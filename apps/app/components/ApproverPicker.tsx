import { useState } from "react";
import { Users } from "lucide-react";

import { describeGroupName } from "../../../packages/utils/groupName";
import { searchApprovers, type approverOptions } from "../binderSettings";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { RemoveButton } from "./RemoveButton";

type Options = ReturnType<typeof approverOptions>;

/**
 * Who approves changes: the chosen groups and people, and a search over the
 * whole organization to add more.
 *
 * **Everybody is shown; only somebody who can read the binder can be picked.**
 * Gitea counts nobody who cannot read it, so offering them would offer an
 * approver who approves nothing. They are listed, dimmed, saying why, so
 * nobody wonders where a colleague went. Shared by a binder's settings and the
 * new-binder form, so the two cannot drift apart.
 */
export function ApproverPicker({
  id,
  groups,
  people,
  options,
  canPick,
  disabled,
  onChange,
}: {
  id: string;
  groups: string[];
  people: string[];
  options: Options;
  canPick: (kind: "group" | "person", value: string) => boolean;
  disabled: boolean;
  onChange: (next: { groups: string[]; people: string[] }) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = searchApprovers(
    options,
    query,
    { groups, people },
    describeGroupName,
    canPick,
  );
  const nameOf = (login: string) =>
    options.people.find((person) => person.login === login)?.name ?? login;

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
                <span className="bs-row-name">{describeGroupName(group)}</span>
                <span className="bs-row-meta">Group</span>
              </span>
              <span className="bs-row-right">
                <RemoveButton
                  label={`Remove ${describeGroupName(group)}`}
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
          {people.map((login) => (
            <li className="bs-row" key={`person:${login}`}>
              <PersonAvatar
                person={{ login, fullName: nameOf(login) }}
                size="sm"
              />
              <span className="bs-row-body">
                <span className="bs-row-name">{nameOf(login)}</span>
                <span className="bs-row-meta">@{login}</span>
              </span>
              <span className="bs-row-right">
                <RemoveButton
                  label={`Remove ${nameOf(login)}`}
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
          ))}
        </ul>
      ) : null}
      <label className="sr-only" htmlFor={id}>
        Search for a group or person who approves changes
      </label>
      <input
        id={id}
        className="rev-picker-input"
        type="search"
        autoComplete="off"
        placeholder="Search groups and people…"
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {!open ? null : matches.length > 0 ? (
        <ul className="rev-picker-results">
          {matches.map((match) => (
            <li key={`${match.kind}:${match.value}`}>
              <button
                type="button"
                className="rev-picker-result"
                disabled={disabled || !match.canPick}
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
                    {match.canPick
                      ? match.kind === "group"
                        ? "Group"
                        : `@${match.login}`
                      : "No access to this binder"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rev-picker-hint">Nothing matches that.</p>
      )}
    </div>
  );
}
