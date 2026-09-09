/**
 * What an organization calls itself, given what the URL calls it.
 *
 * The address bar carries the Gitea org username — `riverside-health` — and
 * that is the only name most screens have to hand. It is not the name the
 * customer chose: "Riverside Health" is, and the organization switcher in the
 * top bar has been showing it all along, directly above headings that showed
 * the slug.
 *
 * A hook rather than a prop drilled from the shell because three screens want
 * the same answer and none of them own the list. Failure is silent on purpose:
 * every caller falls back to the slug, which is what it displayed before, so a
 * switcher-sized problem never becomes an error on a page about something
 * else.
 */

import { useEffect, useState } from "react";

import { fetchOrganizations } from "./api";

export function useOrganizationDisplayName(org: string): string {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset first: without this, moving between organizations shows the
    // previous one's name until the new list lands.
    setDisplayName(null);

    fetchOrganizations()
      .then((rows) => {
        if (cancelled) return;
        const match = rows.find((row) => row.name === org);
        if (match?.displayName) setDisplayName(match.displayName);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [org]);

  return displayName ?? org;
}
