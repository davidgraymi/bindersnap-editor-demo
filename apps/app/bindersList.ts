import type { WorkspaceSummary } from "../../packages/api-schema/schemas/workspaces";
import { formatDocumentName } from "./documentDisplay";

/**
 * Your binders, across every organization you are in — the page that was
 * "Documents".
 *
 * **A binder is the scope, the way a repository is on GitHub.** Documents in
 * different binders live under different rules and different people, so a
 * list that mixed them answered nothing a person arrives with. This lists
 * the binders themselves, the way GitHub's dashboard lists repositories, and
 * a binder opens to its documents.
 *
 * Pure, so the order is decided in one place and tested without rendering.
 */

/** How the page orders binders. */
export type BinderSort = "relevant" | "active" | "name";

export const BINDER_SORTS: ReadonlyArray<{ id: BinderSort; label: string }> = [
  { id: "relevant", label: "Relevant" },
  { id: "active", label: "Most active" },
  { id: "name", label: "A–Z" },
];

/** What you may do in a binder, in a word or two. */
export function describeBinderAccess(binder: WorkspaceSummary): string {
  if (binder.access?.admin) return "Admin";
  if (binder.access?.push) return "Can edit";
  return "Can read";
}

/** How much a binder is yours: admin, then edit, then read. */
function accessWeight(binder: WorkspaceSummary): number {
  if (binder.access?.admin) return 2;
  if (binder.access?.push) return 1;
  return 0;
}

function updated(binder: WorkspaceSummary): number {
  const at = new Date(binder.updatedAt).getTime();
  return Number.isNaN(at) ? 0 : at;
}

function byName(a: WorkspaceSummary, b: WorkspaceSummary): number {
  return formatDocumentName(a.name).localeCompare(formatDocumentName(b.name));
}

/**
 * The binders in the order asked for.
 *
 * - **Relevant**: the binders you write in first — you run them or edit them,
 *   so they are where your work is — then the ones you read, each most
 *   recently moved first.
 * - **Most active**: the most open change requests first, which is where a
 *   binder is busy right now, then most recently moved.
 * - **A–Z**: by name.
 */
export function sortBinders(
  binders: readonly WorkspaceSummary[],
  sort: BinderSort,
): WorkspaceSummary[] {
  const list = [...binders];
  if (sort === "name") return list.sort(byName);
  if (sort === "active") {
    return list.sort(
      (a, b) =>
        b.openChangeCount - a.openChangeCount ||
        updated(b) - updated(a) ||
        byName(a, b),
    );
  }
  return list.sort(
    (a, b) =>
      accessWeight(b) - accessWeight(a) ||
      updated(b) - updated(a) ||
      byName(a, b),
  );
}

/** The binders whose name or description holds what was typed. */
export function filterBindersByText(
  binders: readonly WorkspaceSummary[],
  query: string,
): WorkspaceSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...binders];
  return binders.filter((binder) =>
    [formatDocumentName(binder.name), binder.name, binder.description ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

export interface BinderGroup {
  /** The organization's address, or null when there is only one. */
  org: string | null;
  binders: WorkspaceSummary[];
}

/**
 * One group per organization, in the order their first binder came — or a
 * single group with no heading when every binder is in one organization.
 *
 * **One layout, whatever the count.** Somebody in one organization sees no
 * organization heading at all; somebody in two sees each one's binders under
 * its name. The page never switches to a different design for a count.
 */
export function groupBindersByOrganization(
  binders: readonly WorkspaceSummary[],
): BinderGroup[] {
  const owners = new Set(binders.map((binder) => binder.owner));
  if (owners.size <= 1) return [{ org: null, binders: [...binders] }];
  const groups = new Map<string, WorkspaceSummary[]>();
  for (const binder of binders) {
    const group = groups.get(binder.owner) ?? [];
    group.push(binder);
    groups.set(binder.owner, group);
  }
  return [...groups].map(([org, list]) => ({ org, binders: list }));
}
