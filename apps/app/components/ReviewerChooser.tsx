import { useEffect, useState } from "react";

import { fetchBinderPeople } from "../api";
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
  const [people, setPeople] = useState<BinderPerson[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBinderPeople(org, binder)
      .then((payload) => {
        if (cancelled) return;
        const others = payload.people.filter(
          (person) => person.login !== currentUser,
        );
        setPeople(others);
        onChange(suggestReviewers(others, currentUser));
      })
      // Not being able to list them costs the author a shortcut, not the
      // change: reviewers can still be asked from the change's own page.
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
    // `onChange` is the caller's setter; the suggestion is made once per binder.
  }, [org, binder, currentUser]);

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
          Nobody else is in this binder yet. Add a colleague from the binder’s
          settings, or — if you are running it on your own — set the approvals
          needed to None there, and publish it yourself.
        </p>
      </div>
    );
  }

  const chosen = new Set(selected);

  return (
    <fieldset className="bs-field reviewer-chooser" disabled={disabled}>
      <legend className="bs-field-label">Who should review it</legend>
      <ul className="bs-row-list reviewer-chooser-list">
        {people.map((person) => {
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
              </label>
            </li>
          );
        })}
      </ul>
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
