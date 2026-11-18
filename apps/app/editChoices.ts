/**
 * What Edit offers on a document somebody is already changing.
 *
 * Parallel work is the point of drafts: two people revising two documents
 * never collide, and two revising one are reconciled when the second is
 * published. What goes wrong is not knowing — starting a second change to a
 * paragraph a colleague's change already rewrites, or saving into somebody's
 * change and altering what its reviewers are reading. So Edit asks first,
 * and offers what you may actually do:
 *
 * - **Continue in it**, only to its author and its co-editors — the people
 *   the server lets save into it (`mayEditChange`).
 * - **Comment on it**, to everybody else: on the words, from its Changes tab.
 * - **Start a separate change**, always: your own draft, reviewed on its own.
 */

export interface OpenChangeForEdit {
  number: number;
  title: string;
  user?: { login: string; full_name?: string } | null;
  coEditors?: readonly { login: string }[];
}

export interface EditChoice {
  number: number;
  title: string;
  /** Whose change it is, as a person reads it. */
  authorName: string;
  /** Yours to write in: you made it, or its author named you a co-editor. */
  canContinue: boolean;
  /** You made it. */
  mine: boolean;
}

function personName(user: OpenChangeForEdit["user"]): string {
  return user?.full_name?.trim() || user?.login || "Somebody";
}

/**
 * The changes Edit should ask about, yours to continue first, then by
 * number. A sign-off rules change touches no document and is never listed
 * here, because it is never among a document's open changes.
 */
export function editChoices(
  changes: readonly OpenChangeForEdit[],
  currentUser: string,
): EditChoice[] {
  return changes
    .map((change) => {
      const mine = change.user?.login === currentUser;
      const coEditing = (change.coEditors ?? []).some(
        (editor) => editor.login === currentUser,
      );
      return {
        number: change.number,
        title: change.title.trim() || `Change ${change.number}`,
        authorName: mine ? "You" : personName(change.user),
        canContinue: mine || coEditing,
        mine,
      };
    })
    .sort(
      (a, b) =>
        Number(b.canContinue) - Number(a.canContinue) || a.number - b.number,
    );
}

/** The dialog's one-line question, which says how many and whose. */
export function describeEditChoices(choices: readonly EditChoice[]): string {
  const only = choices.length === 1 ? choices[0] : undefined;
  if (only) {
    if (only.mine) return "You already have a change open for this document.";
    return `${only.authorName} is already changing this document.`;
  }
  return `${choices.length} open changes already change this document.`;
}

/** How a change is named on its row, possessively. */
export function whoseChange(choice: EditChoice): string {
  return choice.mine ? "Your change" : `${choice.authorName}’s change`;
}
