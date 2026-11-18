import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  DiscussionAnchor,
  DiscussionThread,
} from "../../../packages/api-schema/schemas/documents";
import { ICON } from "../../../packages/ui-tokens/icons";
import { followInApp, navigateToHref } from "../appLink";
import { anchorFrom, clampQuote, locateAnchor } from "../textAnchor";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";

/**
 * Commenting on the words, where they are read.
 *
 * A comment belonged to the whole change, so a reviewer with a question
 * about one sentence retyped the sentence into the comment to say which.
 * Here they select the words in the document and choose Comment, as in a
 * word processor. The thread is an ordinary discussion on the change — it
 * is in the Overview with the rest, it can be replied to and resolved, and
 * it can hold up publishing like any other — that also remembers the
 * passage it is about (`textAnchor.ts`).
 *
 * **Wrapped around the document, not built into it.** Three different
 * components draw a document on this screen; this finds the rendered page
 * inside whatever it wraps (`.doc-preview-prose`) and works on its text.
 *
 * The passages are marked with the CSS Custom Highlight API, which paints
 * ranges without touching the page's markup: the document is HTML somebody
 * approved, and wrapping spans into it to show a comment would be editing
 * it. A browser without the API still lists every comment with its quote
 * under the document.
 */

interface PassageCommentsProps {
  /** Which document this is: its identity, or its path when it has none. */
  documentKey: string;
  /** What it is called, kept with the comment. */
  documentLabel: string;
  /** Every thread on the change; the ones about this document are used. */
  threads: readonly DiscussionThread[];
  /** False once the change is decided, or while writing is off. */
  canComment: boolean;
  onComment: (anchor: DiscussionAnchor, body: string) => Promise<void>;
  /** Where a thread is discussed: the change's Overview, at the thread. */
  threadHref: (threadId: string) => string;
  children: ReactNode;
}

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

const PAGE = ".doc-preview-prose";

/** The page's text, in order, and where each piece of it lives. */
function indexText(root: Element): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextIndex["nodes"] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += (node as Text).data;
  }
  return { text, nodes };
}

/** A place in the page as an offset into its text, or null if outside it. */
function offsetOf(index: TextIndex, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const entry = index.nodes.find((candidate) => candidate.node === node);
    return entry ? entry.start + offset : null;
  }
  // An element boundary: the start of the first text at or after it.
  const child = node.childNodes[offset] ?? null;
  for (const entry of index.nodes) {
    if (child) {
      if (
        child === entry.node ||
        child.contains(entry.node) ||
        child.compareDocumentPosition(entry.node) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        return entry.start;
      }
    } else if (
      node.compareDocumentPosition(entry.node) &
        Node.DOCUMENT_POSITION_FOLLOWING &&
      !node.contains(entry.node)
    ) {
      return entry.start;
    }
  }
  return index.text.length;
}

function rangeOf(index: TextIndex, start: number, end: number): Range | null {
  const at = (offset: number, endSide: boolean) => {
    for (let i = index.nodes.length - 1; i >= 0; i -= 1) {
      const entry = index.nodes[i]!;
      const within = endSide ? offset > entry.start : offset >= entry.start;
      if (within) return { node: entry.node, offset: offset - entry.start };
    }
    return null;
  };
  const from = at(start, false);
  const to = at(end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, Math.min(from.offset, from.node.length));
  range.setEnd(to.node, Math.min(to.offset, to.node.length));
  return range;
}

// One registry for the page: every document on the screen adds its ranges.
const OPEN_NAME = "bs-passage";
const SETTLED_NAME = "bs-passage-settled";
const FLASH_NAME = "bs-passage-flash";
const registered = new Map<string, { open: Range[]; settled: Range[] }>();

type HighlightRegistry = Map<string, unknown>;
function highlights(): HighlightRegistry | null {
  const registry = (globalThis.CSS as { highlights?: HighlightRegistry })
    ?.highlights;
  return registry && typeof Highlight !== "undefined" ? registry : null;
}

function repaint(): void {
  const registry = highlights();
  if (!registry) return;
  const open = [...registered.values()].flatMap((entry) => entry.open);
  const settled = [...registered.values()].flatMap((entry) => entry.settled);
  registry.set(OPEN_NAME, new Highlight(...open));
  registry.set(SETTLED_NAME, new Highlight(...settled));
}

function flash(range: Range): void {
  const registry = highlights();
  if (!registry) return;
  registry.set(FLASH_NAME, new Highlight(range));
  window.setTimeout(() => registry.delete(FLASH_NAME), 1600);
}

interface Placed {
  thread: DiscussionThread;
  start: number;
  end: number;
  range: Range;
}

interface Draft {
  anchor: DiscussionAnchor;
  /** Where the button and the box sit, within the wrapper. */
  top: number;
  left: number;
  writing: boolean;
}

export function PassageComments({
  documentKey,
  documentLabel,
  threads,
  canComment,
  onComment,
  threadHref,
  children,
}: PassageCommentsProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const registryKey = useId();
  const listId = useId();
  const mine = threads.filter(
    (thread) => thread.anchor?.document === documentKey,
  );
  // The page is drawn by a child, some time after this mounts, and redrawn
  // when the change is edited: count its redraws and work from the count.
  const [drawn, setDrawn] = useState(0);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new MutationObserver(() => setDrawn((count) => count + 1));
    observer.observe(wrap, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const threadsKey = mine
    .map((thread) => `${thread.id}:${thread.resolved ? 1 : 0}`)
    .join(",");

  // Find each thread's words in the page as it is drawn now.
  useLayoutEffect(() => {
    const page = wrapRef.current?.querySelector(PAGE);
    if (!page) {
      registered.delete(registryKey);
      repaint();
      setPlaced([]);
      return;
    }
    const index = indexText(page);
    const found: Placed[] = [];
    for (const thread of mine) {
      if (!thread.anchor) continue;
      const at = locateAnchor(index.text, thread.anchor);
      const range = at ? rangeOf(index, at.start, at.end) : null;
      if (at && range) found.push({ thread, ...at, range });
    }
    registered.set(registryKey, {
      open: found.filter((entry) => !entry.thread.resolved).map((e) => e.range),
      settled: found
        .filter((entry) => entry.thread.resolved)
        .map((e) => e.range),
    });
    repaint();
    setPlaced(found);
    return () => {
      registered.delete(registryKey);
      repaint();
    };
    // `mine` is rebuilt every render; `threadsKey` is what it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn, threadsKey, registryKey]);

  /** Words were selected in the page: offer to comment on them. */
  const onSelect = useCallback(() => {
    if (!canComment) return;
    const wrap = wrapRef.current;
    const page = wrap?.querySelector(PAGE);
    const selection = window.getSelection();
    if (!wrap || !page || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (
      selection.isCollapsed ||
      !page.contains(range.startContainer) ||
      !page.contains(range.endContainer)
    ) {
      setDraft((current) => (current?.writing ? current : null));
      return;
    }
    const index = indexText(page);
    const start = offsetOf(index, range.startContainer, range.startOffset);
    const end = offsetOf(index, range.endContainer, range.endOffset);
    const anchor =
      start === null || end === null
        ? null
        : anchorFrom(index.text, start, end);
    if (!anchor) return;
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    setError(null);
    setDraft({
      anchor: {
        document: documentKey,
        label: documentLabel,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
      },
      top: last.bottom - box.top + 6,
      left: Math.max(0, Math.min(last.right - box.left, box.width - 320)),
      writing: false,
    });
  }, [canComment, documentKey, documentLabel]);

  /** A click on marked words opens the comment that is about them. */
  const onClickPage = (event: React.MouseEvent) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const page = wrapRef.current?.querySelector(PAGE);
    if (
      !page ||
      !(event.target instanceof Node) ||
      !page.contains(event.target)
    )
      return;
    const hit = placed.find((entry) =>
      [...entry.range.getClientRects()].some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      ),
    );
    if (!hit) return;
    const row = document.getElementById(`${listId}-${hit.thread.id}`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    row
      ?.querySelector<HTMLElement>("a, button")
      ?.focus({ preventScroll: true });
  };

  const submit = async () => {
    if (!draft || body.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onComment(draft.anchor, body.trim());
      setDraft(null);
      setBody("");
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to add that comment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setDraft(null);
    setBody("");
    setError(null);
  };

  const show = (entry: Placed | undefined) => {
    if (!entry) return;
    entry.range.startContainer.parentElement?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    flash(entry.range);
  };

  return (
    <div className="passage" ref={wrapRef}>
      <div
        className="passage-page"
        onMouseUp={onSelect}
        onKeyUp={onSelect}
        onClick={onClickPage}
      >
        {children}
      </div>

      {draft && !draft.writing ? (
        <button
          type="button"
          className="bs-btn bs-btn-secondary bs-btn--sm passage-offer"
          style={{ top: draft.top, left: draft.left }}
          // Keep the selection: pressing a button would otherwise clear it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setDraft({ ...draft, writing: true })}
        >
          <AppIcon icon={ICON.comment} size="sm" />
          Comment
        </button>
      ) : null}

      {draft?.writing ? (
        <form
          className="bs-panel passage-compose"
          style={{ top: draft.top, left: draft.left }}
          aria-label="Comment on this passage"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <blockquote className="passage-quote">
            {clampQuote(draft.anchor.quote)}
          </blockquote>
          <textarea
            className="bs-input"
            aria-label="Your comment"
            placeholder="What about it?"
            rows={3}
            value={body}
            autoFocus
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancel();
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {error ? (
            <p className="bs-note bs-note--danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="passage-compose-acts">
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn--quiet"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bs-btn bs-btn-primary bs-btn--sm"
              disabled={busy || body.trim() === ""}
            >
              {busy ? "Adding…" : "Comment"}
            </button>
          </div>
        </form>
      ) : null}

      {mine.length > 0 ? (
        <section
          className="passage-list"
          aria-label="Comments on this document"
        >
          <h3 className="passage-list-title">
            Comments on this document
            <span className="bs-section-count">{mine.length}</span>
          </h3>
          <ul className="bs-row-list">
            {mine.map((thread) => {
              const first = thread.comments[0];
              const where = placed.find(
                (entry) => entry.thread.id === thread.id,
              );
              const replies = thread.comments.length - 1;
              const href = threadHref(thread.id);
              return (
                <li
                  className={`passage-item${
                    thread.resolved ? " passage-item--settled" : ""
                  }`}
                  id={`${listId}-${thread.id}`}
                  key={thread.id}
                >
                  {where ? (
                    <button
                      type="button"
                      className="passage-quote passage-quote--go"
                      title="Show these words in the document"
                      onClick={() => show(where)}
                    >
                      {clampQuote(thread.anchor?.quote ?? "")}
                    </button>
                  ) : (
                    <p className="passage-quote passage-quote--gone">
                      {clampQuote(thread.anchor?.quote ?? "")}
                      <span className="passage-gone-note">
                        These words have changed since the comment was made.
                      </span>
                    </p>
                  )}
                  {first ? (
                    <div className="passage-said">
                      <PersonAvatar
                        person={{
                          login: first.author.login,
                          fullName: first.author.fullName,
                        }}
                        size="sm"
                      />
                      <p>
                        <strong>
                          {first.author.fullName.trim() || first.author.login}
                        </strong>{" "}
                        {first.body}
                      </p>
                    </div>
                  ) : null}
                  <p className="passage-foot">
                    <span>
                      {thread.resolved ? "Resolved" : "Open"}
                      {replies > 0
                        ? ` · ${replies} ${replies === 1 ? "reply" : "replies"}`
                        : ""}
                    </span>
                    <a
                      href={href}
                      onClick={(event) =>
                        followInApp(event, () => navigateToHref(href))
                      }
                    >
                      {thread.resolved
                        ? "Open the discussion"
                        : "Reply or resolve"}
                    </a>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
