/**
 * A person's name, as the record writes it.
 *
 * Gitea keeps one `full_name` per account, and every place that names somebody
 * — a reviewer in a change, an approver in a version's tag, a row in an audit
 * packet — reads that field. The form asks for a first and a last name because
 * that is how people expect to be asked; they are joined into the one field
 * here, and split back out of it for editing, by the same rule on both sides.
 */

/** Gitea's own limit on `full_name`. */
export const MAX_FULL_NAME_LENGTH = 100;

export function joinFullName(first: string, last: string): string {
  return [first, last]
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");
}

/**
 * Back into the two fields, for editing.
 *
 * The first word is the first name and the rest is the last. That is wrong for
 * "Mary Ann Smith", who will see "Mary" and "Ann Smith" — and still right where
 * it matters, because joining them again gives back exactly what was stored.
 */
export function splitFullName(fullName: string): {
  first: string;
  last: string;
} {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? "", last: words.slice(1).join(" ") };
}

/** Why a first and last name cannot be saved, or null when they can. */
export function validateFullName(first: string, last: string): string | null {
  if (first.trim() === "" || last.trim() === "") {
    return "Enter your first and last name.";
  }
  if (joinFullName(first, last).length > MAX_FULL_NAME_LENGTH) {
    return `Your name can be at most ${MAX_FULL_NAME_LENGTH} characters.`;
  }
  return null;
}
