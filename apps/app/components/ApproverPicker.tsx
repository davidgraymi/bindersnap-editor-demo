import { useState } from "react";
import { Users } from "lucide-react";

import { describeGroupName } from "../../../packages/utils/groupName";
import { searchApprovers, type approverOptions } from "../binderSettings";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";
import { RemoveButton } from "./RemoveButton";

type Options = ReturnType<typeof approverOptions>;

/** One group or person, as a row. */
function Who({
  kind,
  value,
  options,
  right,
}: {
  kind: "group" | "person";
  value: string;
  options: Options;
  right: React.ReactNode;
}) {
  const name =
    kind === "group"
      ? describeGroupName(value)
      : (options.people.find((person) => person.login === value)?.name ??
        value);
  return (
    <li className="bs-row">
      {kind === "group" ? (
        <span className="bs-row-icon">
          <AppIcon icon={Users} size="sm" />
        </span>
      ) : (
        <PersonAvatar person={{ login: value, fullName: name }} size="sm" />
      )}
      <span className="bs-row-body">
        <span className="bs-row-name">{name}</span>
        <span className="bs-row-meta">
          {kind === "group" ? "Group" : `@${value}`}
        </span>
      </span>
      <span className="bs-row-right">{right}</span>
    </li>
  );
}

/**
 * Who approves changes: the chosen groups and people, a search box to add
 * more, and — only when somebody chosen cannot read the binder yet — an
 * Access section with them in it.
 *
 * Anybody can be chosen; nothing is refused. Gitea keeps an approver only
 * once they can read the binder, which is all the Access section is for. On a
 * binder that exists each row has a Give access button; on the new-binder form
 * the rows are given access when the binder is made, and Remove leaves one out.
 */
export function ApproverPicker({
  id,
  groups,
  people,
  options,
  disabled,
  onChange,
  access,
}: {
  id: string;
  groups: string[];
  people: string[];
  options: Options;
  disabled: boolean;
  onChange: (next: { groups: string[]; people: string[] }) => void;
  access?: {
    groups: string[];
    people: string[];
    /** Give access now, on a binder that exists. */
    onGrant?: (kind: "group" | "person", value: string) => void;
    /** Leave one out, on a binder about to be made. */
    onSkip?: (kind: "group" | "person", value: string) => void;
    busy?: string | null;
  };
}) {
  const [query, setQuery] = useState("");
  const matches = searchApprovers(
    options,
    query,
    { groups, people },
    describeGroupName,
  );
  const remove = (kind: "group" | "person", value: string) =>
    onChange(
      kind === "group"
        ? { groups: groups.filter((entry) => entry !== value), people }
        : { groups, people: people.filter((entry) => entry !== value) },
    );
  const accessRows = access
    ? [
        ...access.groups.map((value) => ({ kind: "group" as const, value })),
        ...access.people.map((value) => ({ kind: "person" as const, value })),
      ]
    : [];

  return (
    <div className="bs-fields">
      {groups.length + people.length > 0 ? (
        <ul className="bs-row-list">
          {groups.map((group) => (
            <Who
              key={`group:${group}`}
              kind="group"
              value={group}
              options={options}
              right={
                <RemoveButton
                  label={`Remove ${describeGroupName(group)}`}
                  busy={disabled}
                  onClick={() => remove("group", group)}
                />
              }
            />
          ))}
          {people.map((login) => (
            <Who
              key={`person:${login}`}
              kind="person"
              value={login}
              options={options}
              right={
                <RemoveButton
                  label={`Remove ${login}`}
                  busy={disabled}
                  onClick={() => remove("person", login)}
                />
              }
            />
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
        <p className="rev-picker-hint">Nothing matches that.</p>
      )}

      {accessRows.length > 0 ? (
        <div className="bs-fields">
          <span className="bs-field-label">Access</span>
          <ul className="bs-row-list">
            {accessRows.map((row) => (
              <Who
                key={`access:${row.kind}:${row.value}`}
                kind={row.kind}
                value={row.value}
                options={options}
                right={
                  access?.onGrant ? (
                    <button
                      type="button"
                      className="bs-btn bs-btn--sm bs-btn-secondary"
                      disabled={disabled || Boolean(access.busy)}
                      onClick={() => access.onGrant?.(row.kind, row.value)}
                    >
                      {access.busy === `${row.kind}:${row.value}`
                        ? "Giving access…"
                        : "Give access"}
                    </button>
                  ) : (
                    <RemoveButton
                      label={`Don't give ${row.value} access`}
                      busy={disabled}
                      onClick={() => access?.onSkip?.(row.kind, row.value)}
                    />
                  )
                }
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
