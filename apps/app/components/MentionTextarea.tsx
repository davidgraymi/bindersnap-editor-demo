import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

import { searchUsersQuery } from "../data/queries";
import { capitalizeFirst } from "../documentDisplay";
import {
  findMentionQuery,
  insertMention,
  splitMentions,
  type MentionQuery,
} from "../mentions";
import { FloatingResults } from "./FloatingResults";
import { PersonAvatar } from "./PersonAvatar";

const SEARCH_DEBOUNCE_MS = 150;
/** A tiny search: a handful of names, never a page of them. */
const SUGGESTION_LIMIT = 6;

type MentionTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
};

interface Suggestion {
  login: string;
  fullName: string;
}

/**
 * A text box that knows `@username`.
 *
 * Typing `@` and part of a name opens a short list of the people the writer
 * shares an organization with who match it (the same search the reviewer
 * picker uses, `GET /api/app/users/search`). Up and Down move through it,
 * Enter or Tab puts `@login` in the text, Escape closes it and leaves the
 * words alone. Focus never leaves the box, so typing carries on as before.
 *
 * Use it for the words people write to each other — threads, replies, a
 * change's description — and never for a document.
 */
export function MentionTextarea({
  value,
  onValueChange,
  textareaRef,
  onKeyDown,
  onBlur,
  onSelect,
  disabled,
  ...rest
}: MentionTextareaProps) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState("");
  const pendingCaret = useRef<number | null>(null);

  const query = mention?.query ?? "";
  useEffect(() => {
    const handle = window.setTimeout(
      () => setDebounced(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(handle);
  }, [query]);

  const open = mention !== null && mention.start !== dismissedAt && !disabled;
  const asking = open && debounced.length > 0;
  const found = useQuery({
    ...searchUsersQuery(debounced, SUGGESTION_LIMIT),
    enabled: asking,
    placeholderData: keepPreviousData,
  });

  const suggestions: Suggestion[] = useMemo(
    () =>
      asking
        ? (found.data?.users ?? [])
            .map((user) => ({
              login: user.login ?? "",
              fullName: user.full_name ?? "",
            }))
            .filter((user) => user.login)
        : [],
    [asking, found.data],
  );

  useEffect(() => {
    setActive((current) =>
      suggestions.length === 0 ? 0 : Math.min(current, suggestions.length - 1),
    );
  }, [suggestions.length]);

  // After a name goes in, the caret goes after it rather than to the end.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const box = ownRef.current;
    if (caret === null || !box) return;
    pendingCaret.current = null;
    box.focus();
    box.setSelectionRange(caret, caret);
  });

  function track(box: HTMLTextAreaElement) {
    const caret =
      box.selectionStart === box.selectionEnd ? box.selectionStart : -1;
    const next = findMentionQuery(box.value, caret);
    // A new `@` (or none) starts afresh; Escape closed only the one it was on.
    if (next?.start !== mention?.start) {
      setActive(0);
      setDismissedAt(null);
    }
    setMention(next);
  }

  function choose(user: Suggestion) {
    if (!mention) return;
    const next = insertMention(value, mention, user.login);
    pendingCaret.current = next.caret;
    setMention(null);
    onValueChange(next.text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "Escape") {
        // Closes the list only: the comment being written stays open.
        event.preventDefault();
        event.nativeEvent.stopImmediatePropagation();
        setDismissedAt(mention.start);
        return;
      }
      if (suggestions.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((current) => (current + 1) % suggestions.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive(
            (current) =>
              (current - 1 + suggestions.length) % suggestions.length,
          );
          return;
        }
        if (
          (event.key === "Enter" || event.key === "Tab") &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.nativeEvent.isComposing
        ) {
          const user = suggestions[active];
          if (user) {
            event.preventDefault();
            choose(user);
            return;
          }
        }
      }
    }
    onKeyDown?.(event);
  }

  const activeId =
    open && suggestions.length > 0 ? `${listId}-${active}` : undefined;

  return (
    <>
      <textarea
        {...rest}
        ref={(node) => {
          ownRef.current = node;
          if (typeof textareaRef === "function") textareaRef(node);
          else if (textareaRef) textareaRef.current = node;
        }}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        onChange={(event) => {
          onValueChange(event.target.value);
          track(event.target);
        }}
        onSelect={(event) => {
          track(event.currentTarget);
          onSelect?.(event);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          setMention(null);
          onBlur?.(event);
        }}
      />
      {open ? (
        <FloatingResults
          anchor={ownRef}
          onClose={() => setDismissedAt(mention.start)}
        >
          {!asking ? (
            <p className="rev-picker-hint">Type a name to mention someone.</p>
          ) : suggestions.length > 0 ? (
            <ul
              className="rev-picker-results"
              id={listId}
              role="listbox"
              aria-label="People to mention"
            >
              {suggestions.map((user, index) => (
                <li
                  key={user.login}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className="rev-picker-result mention-option"
                  // Keep focus, and the caret, in the text box.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(user)}
                >
                  <PersonAvatar person={user} size="sm" />
                  <span className="rev-picker-identity">
                    <span className="rev-picker-name">
                      {user.fullName.trim() || capitalizeFirst(user.login)}
                    </span>
                    <span className="rev-picker-login">@{user.login}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rev-picker-hint">
              {found.isFetching ? "Searching…" : "Nobody matches that."}
            </p>
          )}
        </FloatingResults>
      ) : null}
    </>
  );
}

/**
 * Words somebody wrote, with each `@username` drawn as a mention. Everything
 * else is shown exactly as typed.
 */
export function MentionText({ text }: { text: string }) {
  const parts = useMemo(() => splitMentions(text), [text]);
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "mention" ? (
          <span className="bs-mention" key={index} title={`@${part.login}`}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
