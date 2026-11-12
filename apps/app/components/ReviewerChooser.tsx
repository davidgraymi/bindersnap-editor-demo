import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { binderPeopleQuery, binderSignOffQuery } from "../data/queries";
import {
  approverLogins,
  approversFirst,
  describeApprovalNeed,
} from "../proposeSignOff";
import type { BinderPerson } from "../../../packages/api-schema/schemas/workspaces";

/**
 * Who a new change request goes to, chosen as it is opened.
 *
 * **A change nobody was asked to look at waits on nobody.** Before this, a
 * change opened with "Nobody has been asked to review this yet" and the author
 * had to find the right panel on the change page to fix it — which a person
 * submitting their first policy did not know to do. Asking here puts the
 * question where the author is already deciding what to send.
 *
 * **Everyone in a small binder is ticked to start with.** Three people or fewer
 * is a team where the author would ask all of them; more than that and a
 * guess would put the change on desks it does not belong on, so the list
 * starts empty and says so.
 */

/** A binder this small asks everyone unless the author says otherwise. */
const ASK_EVERYONE_UP_TO = 3;

export function suggestReviewers(
  people: readonly Pick<BinderPerson, "login">[],
  currentUser: string,
): string[] {
  const eligible = people.filter((person) => person.login !== currentUser);
  return eligible.length <= ASK_EVERYONE_UP_TO
    ? eligible.map((person) => person.login)
    : [];
}

interface ReviewerChooserProps {
  org: string;
  binder: string;
  /** The author, who can never review their own change. */
  currentUser: string;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function ReviewerChooser({
  org,
  binder,
  currentUser,
  selected,
  onChange,
  disabled = false,
}: ReviewerChooserProps) {
  // Not being able to list them costs the author a shortcut, not the change:
  // reviewers can still be asked from the change's own page.
  const read = useQuery(binderPeopleQuery(org, binder));
  // The rules in force are the record's: one changed in this draft starts
  // with the change after it.
  const signOff = useQuery(binderSignOffQuery(org, binder));
  const people: BinderPerson[] | null = useMemo(
    () =>
      read.data
        ? read.data.people.filter((person) => person.login !== currentUser)
        : read.isError
          ? []
          : null,
    [read.data, read.isError, currentUser],
  );

  // The suggestion is made once per binder, when its people first arrive.
  const suggestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!read.data || people === null) return;
    const key = `${org}/${binder}/${currentUser}`;
    if (suggestedFor.current === key) return;
    suggestedFor.current = key;
    onChange(suggestReviewers(people, currentUser));
    // `onChange` is the caller's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read.data, people, org, binder, currentUser]);

  if (people === null) {
    return (
      <div className="bs-field">
        <span className="bs-field-label">Who should review it</span>
        <p className="bs-field-hint">Finding the people in this binder…</p>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="bs-field">
        <span className="bs-field-label">Who should review it</span>
        <p className="bs-field-hint">
          Nobody else is in this binder yet. A new binder needs no approvals, so
          you can publish this yourself — or add a colleague from the binder’s
          settings to review it first.
        </p>
      </div>
    );
  }

  const chosen = new Set(selected);
  // Whose approval counts, and how many the binder needs: said here, before
  // the change exists, so nobody asks three people who cannot approve.
  const approvers = approverLogins(signOff.data ?? null);
  const canApprove = (login: string) => approvers.has(login.toLowerCase());
  const everybodyCan = people.every((person) => canApprove(person.login));
  const need = signOff.data
    ? describeApprovalNeed(
        signOff.data.requiredApprovals,
        people.filter((person) => canApprove(person.login)).length,
        everybodyCan,
      )
    : null;
  const listed = approversFirst(people, approvers);

  return (
    <fieldset className="bs-field reviewer-chooser" disabled={disabled}>
      <legend className="bs-field-label">Who should review it</legend>
      {need ? (
        <p
          className={`bs-note reviewer-chooser-need${
            need.blocked ? " bs-note--warn" : ""
          }`}
        >
          {need.line}
        </p>
      ) : null}
      <ul className="bs-row-list reviewer-chooser-list">
        {listed.map((person) => {
          const id = `reviewer-${person.login}`;
          return (
            <li className="bs-row" key={person.login}>
              <input
                id={id}
                className="bs-checkbox"
                type="checkbox"
                checked={chosen.has(person.login)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if (event.target.checked) next.add(person.login);
                  else next.delete(person.login);
                  onChange([...next]);
                }}
              />
              <label className="bs-row-body" htmlFor={id}>
                <span className="bs-row-name">
                  {person.fullName.trim() || person.login}
                </span>
                {/* Two people can share a name; nobody shares a login. */}
                {person.fullName.trim() ? (
                  <span className="bs-row-meta">@{person.login}</span>
                ) : null}
              </label>
              {need && !everybodyCan && canApprove(person.login) ? (
                <span className="bs-status bs-status--sm reviewer-chooser-can">
                  Can approve
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {need && !need.blocked && signOff.data?.requiredApprovals ? (
        <p className="bs-field-hint">
          A folder or a document can ask for its own sign-off as well. The
          change request lists every rule once it is open.
        </p>
      ) : null}
      <p className="bs-field-hint">
        {chosen.size === 0
          ? "Nobody is asked yet. You can ask people from the change request later."
          : chosen.size === 1
            ? "They will see it waiting on them when they sign in."
            : "They will each see it waiting on them when they sign in."}
      </p>
    </fieldset>
  );
}
