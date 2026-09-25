/**
 * The names behind an organization's logins.
 *
 * **The history names people by login, and a login is not a name.** A version
 * records who published it and who approved it as Gitea usernames, and the
 * binder's history drew them as that — "Published by Carol", with a "CA" face
 * beside it — while every other page drew the same person as "Carol Mendes"
 * and "CM". One person, two faces and two names, a page apart. The names are
 * in the organization's people list, which several screens read already; this
 * reads it once per organization and answers "what is this login called".
 *
 * Failure is silent, and every answer falls back to the login: a history that
 * cannot find a name still has to say who it was.
 *
 * Cached as the promise, per organization, so the history, the binder's
 * latest-change card and anything else asking at once share one request.
 * Dropped on failure, so a transient error is not replayed for the tab's life.
 */

import { useEffect, useState } from "react";

import { fetchOrganizationPeople } from "./api";

type NameMap = ReadonlyMap<string, string>;

const inFlight = new Map<string, Promise<NameMap>>();

function loadNames(org: string): Promise<NameMap> {
  let pending = inFlight.get(org);
  if (!pending) {
    pending = fetchOrganizationPeople(org)
      .then(
        (payload) =>
          new Map(
            payload.people
              .filter((person) => person.fullName.trim() !== "")
              .map((person) => [
                person.login.toLowerCase(),
                person.fullName.trim(),
              ]),
          ),
      )
      .catch((err: unknown) => {
        inFlight.delete(org);
        throw err;
      });
    inFlight.set(org, pending);
  }
  return pending;
}

/** Only for tests: forget what was fetched. */
export function resetPeopleNamesCache(): void {
  inFlight.clear();
}

/**
 * "Carol Mendes" for `carol` — or "Carol", the login capitalized, while the
 * names are loading or when the person has none.
 */
export function nameFor(names: NameMap | null, login: string): string {
  return (
    names?.get(login.toLowerCase()) ??
    login.charAt(0).toUpperCase() + login.slice(1)
  );
}

/** Everyone in the organization, by login — null until it is known. */
export function usePeopleNames(org: string): NameMap | null {
  const [names, setNames] = useState<NameMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadNames(org)
      .then((next) => {
        if (!cancelled) setNames(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [org]);

  return names;
}
