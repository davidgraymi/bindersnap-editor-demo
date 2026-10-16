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
 * One query per organization, shared with every other screen reading its people.
 */

import { useQuery } from "@tanstack/react-query";

import { organizationPeopleQuery } from "./data/queries";
import type { OrganizationPeoplePayload } from "../../packages/api-schema/schemas/workspaces";

type NameMap = ReadonlyMap<string, string>;

function namesOf(payload: OrganizationPeoplePayload): NameMap {
  return new Map(
    payload.people
      .filter((person) => person.fullName.trim() !== "")
      .map((person) => [person.login.toLowerCase(), person.fullName.trim()]),
  );
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
  return (
    useQuery({ ...organizationPeopleQuery(org), select: namesOf }).data ?? null
  );
}
