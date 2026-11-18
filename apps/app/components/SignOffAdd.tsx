import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { describeGroupName } from "../../../packages/utils/groupName";
import {
  approverOptions,
  approverReach,
  searchApprovers,
} from "../binderSettings";
import { binderSettingsQuery, organizationPeopleQuery } from "../data/queries";
import { FloatingResults } from "./FloatingResults";
import { PersonAvatar } from "./PersonAvatar";

/**
 * "Add a group or a person", in the editor's sign-off panel.
 *
 * The approver picker's search and its rule: everybody in the organization is
 * listed, and only someone who can read the binder can be picked — Gitea holds
 * the merge for an approval nobody can give otherwise.
 */
export function SignOffAdd({
  org,
  binder,
  already,
  busy,
  onAdd,
}: {
  org: string;
  binder: string;
  /** Who is on this place's own rule already. */
  already: { groups: string[]; people: string[] };
  busy: boolean;
  onAdd: (owner: { kind: "team" | "user"; name: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const people = useQuery(organizationPeopleQuery(org)).data;
  const settings = useQuery(binderSettingsQuery(org, binder)).data;

  const options = approverOptions(
    (people?.groups ?? []).map((group) => group.name),
    people?.people ?? [],
  );
  const canPick = approverReach(
    settings?.teams ?? [],
    (people?.people ?? [])
      .filter((person) => person.isOwner)
      .map((person) => person.login),
  );
  const matches = searchApprovers(
    options,
    query,
    already,
    describeGroupName,
    canPick,
  );

  return (
    <div className="signoff-picker">
      <label className="sr-only" htmlFor="signoff-add">
        Add a group or a person who signs off here
      </label>
      <span className="signoff-picker-field">
        <AppIcon icon={ICON.add} size="sm" />
        <input
          ref={inputRef}
          id="signoff-add"
          className="rev-picker-input"
          type="search"
          autoComplete="off"
          placeholder="Add a group or a person"
          value={query}
          disabled={busy}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
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
      </span>
      {open ? (
        <FloatingResults anchor={inputRef} onClose={() => setOpen(false)}>
          {matches.length > 0 ? (
            <ul className="rev-picker-results">
              {matches.map((match) => (
                <li key={`${match.kind}:${match.value}`}>
                  <button
                    type="button"
                    className="rev-picker-result"
                    disabled={busy || !match.canPick}
                    onClick={() => {
                      onAdd({
                        kind: match.kind === "group" ? "team" : "user",
                        name: match.value,
                      });
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    {match.kind === "group" ? (
                      <AppIcon icon={ICON.people} size="sm" />
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
        </FloatingResults>
      ) : null}
    </div>
  );
}
