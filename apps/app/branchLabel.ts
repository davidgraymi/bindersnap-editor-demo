/**
 * What to call a change's branch where a person reads it.
 *
 * **A branch name is an address, not a name.** Bindersnap makes every branch
 * itself — `upload/finance/expenses-policy/20260505/140000Z-carol-b39f0c17`,
 * `draft/carol/20260923T101500` — so the chip under a change's title printed a
 * path, a timestamp and a hash where GitLab prints a word somebody chose. Each
 * kind of branch Bindersnap makes has a shape, and each shape has a plain
 * name. Anything else is shown as it is: a branch somebody made by hand has a
 * name they chose.
 *
 * The full branch stays available as the chip's tooltip, for whoever needs it.
 */

import { formatDocumentName } from "./documentDisplay";

/** "Carol Mendes" for `carol`, or whatever the page knows the login as. */
export type BranchNameOf = (login: string) => string;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

export function describeBranch(
  branch: string,
  nameOf: BranchNameOf = (login) => login,
): string {
  const parts = branch.split("/").filter(Boolean);
  const [kind] = parts;

  // upload/<slug path…>/<date>/<time>-<uploader>-<hash>
  if (kind === "upload" && parts.length >= 4) {
    const slugPath = parts.slice(1, -2);
    const document = slugPath[slugPath.length - 1];
    if (document) return `${formatDocumentName(document)} upload`;
  }

  // draft/<login>/<stamp> and shape/<login>/<stamp>
  if ((kind === "draft" || kind === "shape") && parts.length === 3) {
    const who = possessive(firstName(nameOf(parts[1] ?? "")));
    return kind === "draft" ? `${who} draft` : `${who} folder changes`;
  }

  if (kind === "sign-off") return "Sign-off rules";

  return branch;
}
