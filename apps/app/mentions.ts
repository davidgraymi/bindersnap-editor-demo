/**
 * `@username` in the words people write to each other: review threads,
 * replies, a change's description, a request for changes.
 *
 * A mention is plain text — the same `@login` Gitea reads in an issue comment,
 * so Gitea notices it and tells the person, and the record says exactly what
 * was typed. Nothing about a mention is stored anywhere else. These helpers
 * only find one while it is being typed, put the chosen login in its place,
 * and pick them out of text that is being shown.
 *
 * Documents never carry mentions: they are policies, not conversations.
 */

/**
 * A Gitea login: letters, digits, `-`, `_` and `.`, starting with a letter or
 * digit. A trailing `.` is the end of a sentence, never part of the name
 * (Gitea refuses a login ending in one).
 */
const LOGIN_CHAR = /[A-Za-z0-9_.-]/;

/** What may sit right before an `@` for it to start a mention. */
function startsMention(before: string | undefined): boolean {
  // The start of the text, whitespace, or opening punctuation. Not a letter,
  // a digit or a dot, so `name@example.com` is an address, not a mention.
  return before === undefined || /[\s([{"'“‘]/.test(before);
}

/** The `@query` being typed at the caret, if the caret is in one. */
export interface MentionQuery {
  /** Index of the `@`. */
  start: number;
  /** Index just past what has been typed after it (the caret). */
  end: number;
  /** What has been typed after the `@`, possibly empty. */
  query: string;
}

/** The longest a login can usefully be while searching for it. */
const MAX_QUERY_LENGTH = 40;

/**
 * Whether the caret is just after `@` plus part of a login, and what has been
 * typed. `null` when it is anywhere else — so the list closes as soon as the
 * writer types a space, moves away, or the `@` is part of an email address.
 */
export function findMentionQuery(
  text: string,
  caret: number,
): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  let index = caret;
  while (index > 0 && LOGIN_CHAR.test(text[index - 1] ?? "")) {
    index -= 1;
    if (caret - index > MAX_QUERY_LENGTH) return null;
  }
  if (index === 0 || text[index - 1] !== "@") return null;
  const at = index - 1;
  if (!startsMention(at === 0 ? undefined : text[at - 1])) return null;
  const query = text.slice(index, caret);
  // A login starts with a letter or a digit; "@." or "@-" is not a name.
  if (query && !/^[A-Za-z0-9]/.test(query)) return null;
  return { start: at, end: caret, query };
}

/**
 * Put `@login ` in place of the query being typed, and say where the caret
 * goes. A login already followed by a space or punctuation is not given a
 * second space. Whatever of the old word sits after the caret is replaced
 * too, so picking a name in the middle of "@pri|ya" does not leave "ya".
 */
export function insertMention(
  text: string,
  mention: MentionQuery,
  login: string,
): { text: string; caret: number } {
  let end = mention.end;
  while (end < text.length && LOGIN_CHAR.test(text[end] ?? "")) end += 1;
  const after = text.slice(end);
  const spacer = /^[\s,.;:!?)\]]/.test(after) ? "" : " ";
  const inserted = `@${login}${spacer}`;
  return {
    text: text.slice(0, mention.start) + inserted + after,
    caret: mention.start + inserted.length,
  };
}

export type MentionPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; login: string; text: string };

/**
 * Text cut into plain runs and `@login` mentions, for showing a mention as a
 * person rather than as characters. Joining every part's `text` gives back the
 * original exactly.
 */
export function splitMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let plainFrom = 0;
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf("@", index);
    if (at === -1) break;
    let end = at + 1;
    while (end < text.length && LOGIN_CHAR.test(text[end] ?? "")) end += 1;
    // Trailing dots end a sentence; they are not part of the login.
    while (end > at + 1 && text[end - 1] === ".") end -= 1;
    const login = text.slice(at + 1, end);
    const valid =
      startsMention(at === 0 ? undefined : text[at - 1]) &&
      /^[A-Za-z0-9]/.test(login);
    if (!valid) {
      index = at + 1;
      continue;
    }
    if (at > plainFrom) {
      parts.push({ kind: "text", text: text.slice(plainFrom, at) });
    }
    parts.push({ kind: "mention", login, text: text.slice(at, end) });
    plainFrom = end;
    index = end;
  }
  if (plainFrom < text.length) {
    parts.push({ kind: "text", text: text.slice(plainFrom) });
  }
  return parts;
}
