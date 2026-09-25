import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Columns2,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  GitBranch,
  Layers,
} from "lucide-react";

import { downloadDocument } from "../api";
import { followInApp } from "../appLink";
import type { ChangeScope } from "../changeScope";
import {
  describeChangedBadge,
  describeChangedKind,
  describePublishIntent,
  describeReadProgress,
  summarizeChangeScale,
  type ChangedDocumentRow,
} from "../changedDocuments";
import type { ComparisonSummary } from "../documentComparison";
import { classifyDocumentFile } from "../documentFile";
import { DocumentComparison, type ImageMode } from "./DocumentComparison";
import { DocumentPreview } from "./DocumentPreview";

/**
 * Everything one change does to a binder, on one screen.
 *
 * A change is the unit of approval (ADR 0004) and may touch several documents,
 * but until this screen existed the only way to see what it did to all of them
 * was to pick one out of a selector, read its comparison, come back, and pick
 * the next — which is exactly the "which version did we approve?" problem the
 * product exists to end, moved one level up.
 *
 * So: one page, every document, each read against the version it replaces.
 *
 * **Laid out the way a code review is.** A file tree of only what changed on
 * the left, grouped by folder, so any document is one click away; one panel
 * per document on the right, and every control and fact about a document in
 * that panel's single bar — its path (old struck out beside new, when it
 * moved), its word counts, its version step, and View, Download and Viewed.
 * Nothing about a document sits anywhere but its bar, so a reviewer never
 * hunts for where this one keeps its buttons.
 *
 * **Each comparison mounts when it comes near.** Comparing one document means
 * fetching two files and, for a PDF or a Word file, loading a parser to read
 * inside them. Mounting eight of those at once on a change nobody has scrolled
 * yet would spend a reviewer's first ten seconds on documents they have not
 * looked at. They mount a screen ahead instead, which is invisible in use.
 */

interface ChangeComparisonPageProps {
  org: string;
  binder: string;
  changeNumber: number;
  /** The change's own title, so the page says what it is about. */
  title: string;
  /** Whether it is still awaiting a decision — the wording differs. */
  open: boolean;
  /** Who proposed it, for "alice wants to publish 3 documents from …". */
  author: string;
  rows: readonly ChangedDocumentRow[];
  /**
   * The branch holding the proposed files, or null when the change has none
   * on record — a change whose branch has been deleted can still be read, but
   * not compared.
   */
  headRef: string | null;
  /**
   * Which document to open on when the address does not name one. Set when a
   * reviewer arrived by pressing Compare on a particular document.
   */
  focusDocument?: string | null;
  /**
   * The address of the change's branch at its root — the whole binder as the
   * change would leave it. Where the branch under the title links to.
   */
  branchHref: string;
  /** Go to the branch's root, in the app. */
  onOpenBranch: () => void;
  /**
   * The address of one document's proposed file, on the change's branch —
   * what View links to, so it can be opened in a new tab or sent to somebody.
   */
  fileHref: (slugPath: string) => string;
  /** Open one document's proposed file on its own screen. */
  onReadFile: (slugPath: string) => void;
  onDownload: (row: ChangedDocumentRow, gitRef: string) => void;
  /**
   * Whether it is still open, or how it ended — the badge before the line
   * under the title.
   */
  status?: ReactNode;
  /** Overview and Changes: the change's two screens, as tabs under its header. */
  tabs?: ReactNode;
}

/** How far ahead of the viewport a document's comparison starts loading. */
const MOUNT_MARGIN = "900px 0px 900px 0px";

/**
 * Where a reviewer had got to, for as long as they are sitting there.
 *
 * `sessionStorage`, deliberately: this is somebody's place in a long page, not
 * a record of anything. It must never read as a review — the record of who
 * signed off on what is in Gitea, and a checkbox in a browser tab has no
 * business looking like part of it. Same tab, same sitting, remembered; a new
 * tab starts clean.
 */
function readStorageKey(
  org: string,
  binder: string,
  changeNumber: number,
): string {
  return `bindersnap:compare-read:${org}/${binder}#${changeNumber}`;
}

function loadRead(key: string): ReadonlySet<string> {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter(isText) : []);
  } catch {
    // Private-mode Safari throws on `sessionStorage`, and a reviewer losing
    // their place is not a reason to lose the page.
    return new Set<string>();
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function KindIcon({ kind }: { kind: ChangedDocumentRow["kind"] }) {
  const size = 14;
  const strokeWidth = 1.6;
  if (kind === "added")
    return (
      <FilePlus2 size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    );
  if (kind === "removed")
    return <Archive size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
  if (kind === "restored")
    return (
      <ArchiveRestore
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden="true"
      />
    );
  return <FileText size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
}

/**
 * `+112 −8`, drawn the way every diff draws it, or nothing.
 *
 * Nothing until that document's comparison has been read, and nothing for one
 * whose words did not move: a rename says what it did in its path, and a
 * count reading "unchanged" was a word about the absence of anything to count.
 */
function WordCounts({
  summary,
}: {
  summary: ComparisonSummary | null | undefined;
}) {
  if (!summary || summary.identical) return null;
  return (
    <span
      className="cmp-counts"
      aria-label={`${summary.additions} words added, ${summary.deletions} removed`}
    >
      <span className="cmp-counts-add">+{summary.additions}</span>
      <span className="cmp-counts-del">−{summary.deletions}</span>
    </span>
  );
}

/** `clinical/nursing` for `clinical/nursing/hand-hygiene`; "" at the top. */
function folderOf(slugPath: string): string {
  const at = slugPath.lastIndexOf("/");
  return at === -1 ? "" : slugPath.slice(0, at);
}

/**
 * The rows, folder by folder, in the order the tree draws them — and so the
 * order the page does too. A tree that listed a document third and a page
 * that showed it fifth would make every click on it a jump in the wrong
 * direction.
 */
function groupByFolder(rows: readonly ChangedDocumentRow[]) {
  const groups = new Map<string, ChangedDocumentRow[]>();
  for (const row of rows) {
    const folder = folderOf(row.slugPath);
    const group = groups.get(folder);
    if (group) group.push(row);
    else groups.set(folder, [row]);
  }
  return [...groups].map(([folder, members]) => ({ folder, rows: members }));
}

export function ChangeComparisonPage({
  org,
  binder,
  changeNumber,
  title,
  open,
  author,
  rows: listed,
  headRef,
  focusDocument = null,
  branchHref,
  onOpenBranch,
  fileHref,
  onReadFile,
  onDownload,
  status = null,
  tabs = null,
}: ChangeComparisonPageProps) {
  const groups = useMemo(() => groupByFolder(listed), [listed]);
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [counts, setCounts] = useState<
    ReadonlyMap<string, ComparisonSummary | null>
  >(() => new Map());
  const [near, setNear] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [active, setActive] = useState<string | null>(null);
  const [imageModes, setImageModes] = useState<ReadonlyMap<string, ImageMode>>(
    () => new Map(),
  );

  const storageKey = readStorageKey(org, binder, changeNumber);
  const [read, setRead] = useState<ReadonlySet<string>>(() =>
    loadRead(storageKey),
  );

  const sections = useRef(new Map<string, HTMLElement>());
  const streamRef = useRef<HTMLDivElement | null>(null);
  const registerSection = useCallback(
    (anchor: string, node: HTMLElement | null) => {
      if (node) sections.current.set(anchor, node);
      else sections.current.delete(anchor);
    },
    [],
  );

  /** The document the page is trying to hold in view. See `aimAt` below. */
  const aiming = useRef<string | null>(null);
  const aimAt = useCallback((anchor: string) => {
    aiming.current = anchor;
    sections.current.get(anchor)?.scrollIntoView({ block: "start" });
    setActive(anchor);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify([...read]));
    } catch {
      // See `loadRead`: losing the bookmark is not worth losing the page.
    }
  }, [storageKey, read]);

  const anchors = useMemo(() => rows.map((row) => row.anchor), [rows]);

  /**
   * Fetch a comparison's two files as it comes near.
   *
   * A screen ahead of the viewport, so the document is rendered by the time
   * anybody looks at it and nothing is fetched for a document nobody reaches.
   * Never unmounted once mounted: scrolling back up a page that threw its
   * comparisons away would refetch and re-parse every file.
   */
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      // No observer — every browser this product supports has one, but a test
      // renderer may not. Everything mounts, which is correct, just eager.
      setNear(new Set(anchors));
      return;
    }

    const mounting = new IntersectionObserver(
      (entries) => {
        const arrived = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.getAttribute("data-anchor"))
          .filter(isText);
        if (arrived.length === 0) return;
        setNear((previous) => {
          const next = new Set(previous);
          for (const anchor of arrived) next.add(anchor);
          return next;
        });
      },
      { rootMargin: MOUNT_MARGIN },
    );

    for (const anchor of anchors) {
      const node = sections.current.get(anchor);
      if (node) mounting.observe(node);
    }

    return () => mounting.disconnect();
  }, [anchors]);

  /**
   * Which document the rail marks: the one being read.
   *
   * Geometry rather than an `IntersectionObserver` on a band, which is the
   * obvious way to write this and gets the last document wrong. Once the page
   * is scrolled as far as it goes, nothing can cross the band any more — so a
   * link to the last document in a change scrolls to it correctly and the rail
   * goes on pointing at the one above, which reads as the link having failed.
   *
   * The rule: the last document whose top has passed the reading line, and the
   * last document full stop once there is no more page to scroll.
   */
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || typeof requestAnimationFrame === "undefined") return;

    // The app scrolls a panel, not the window, so the listener has to find it.
    let scroller: HTMLElement | null = null;
    for (let node = stream.parentElement; node; node = node.parentElement) {
      const overflow = window.getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        scroller = node;
        break;
      }
    }

    let frame = 0;
    const mark = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let current = anchors[0] ?? null;
      for (const anchor of anchors) {
        const node = sections.current.get(anchor);
        if (node && node.getBoundingClientRect().top <= line) current = anchor;
      }

      const atBottom = scroller
        ? scroller.scrollTop + scroller.clientHeight >=
          scroller.scrollHeight - 2
        : window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2;
      if (atBottom) current = anchors[anchors.length - 1] ?? current;

      setActive(current);
    };

    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(mark);
    };

    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    mark();

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [anchors]);

  /** Open on the document the reader asked for, by link or by button. */
  useEffect(() => {
    const fromHash = window.location.hash.replace(/^#/, "");
    const wanted =
      rows.find((row) => row.anchor === fromHash)?.anchor ??
      (focusDocument
        ? (rows.find((row) => row.slugPath === focusDocument)?.anchor ?? null)
        : null);
    if (!wanted) return;

    /**
     * **The first document is where the page already opens.**
     *
     * Scrolling to it anyway puts its panel at the top of the scrollport,
     * which pushes the change's own name and the line saying how big it is
     * off the screen — so arriving at "everything that changed" showed a diff
     * and no indication of what it belonged to. Every change with one
     * document hit this, which is most of them.
     *
     * A hash is different: somebody sent that link on purpose, and honouring
     * it is the whole reason the anchors exist.
     */
    if (wanted === rows[0]?.anchor && fromHash === "") {
      setActive(wanted);
      return;
    }

    // After paint, so the section exists and the rail has laid out. Holding it
    // there is `aimAt`'s job, below — this only starts the aim.
    const timer = window.setTimeout(() => aimAt(wanted), 0);
    return () => window.clearTimeout(timer);
    // Only on arrival. Re-running it on every render would drag a reviewer
    // back up the page each time a comparison finished loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Keep the page aimed at a document while it is still growing underneath.
   *
   * **A one-shot scroll misses.** Every comparison above the target is a
   * placeholder at the moment of the jump and a full policy a second later, so
   * the target slides hundreds of pixels down the page after the browser has
   * finished scrolling to where it used to be — and a shared link to "the hand
   * hygiene diff" lands on whatever happens to be at the top instead.
   *
   * So the aim is held: re-scroll whenever the stream resizes, and let go the
   * moment the reader takes over. Letting go matters as much as aiming — a page
   * that keeps yanking somebody back to an anchor they have scrolled away from
   * is worse than one that never scrolled at all.
   */
  useEffect(() => {
    const release = () => {
      aiming.current = null;
    };

    const stream = streamRef.current;
    const observer =
      typeof ResizeObserver === "undefined" || !stream
        ? null
        : new ResizeObserver(() => {
            const anchor = aiming.current;
            if (anchor) {
              sections.current.get(anchor)?.scrollIntoView({ block: "start" });
            }
          });
    observer?.observe(stream!);

    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", release);
    // Nothing loads forever, and an aim nobody released is an aim that would
    // fight the next thing to change the page's height.
    const giveUp = window.setTimeout(release, 15_000);

    return () => {
      observer?.disconnect();
      window.clearTimeout(giveUp);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", release);
    };
  }, []);

  const onSummaryFor = useCallback((anchor: string) => {
    return (summary: ComparisonSummary | null) => {
      setCounts((previous) => {
        if (previous.get(anchor) === summary) return previous;
        const next = new Map(previous);
        next.set(anchor, summary);
        return next;
      });
    };
  }, []);

  const goTo = (anchor: string) => {
    setCollapsed((previous) => {
      if (!previous.has(anchor)) return previous;
      const next = new Set(previous);
      next.delete(anchor);
      return next;
    });
    // Through `aimAt`, because a rail click has the same problem an arriving
    // link does: the section being jumped to may not have loaded yet, and
    // unfolding it moves everything below.
    aimAt(anchor);
  };

  const toggleRead = (anchor: string) => {
    setRead((previous) => {
      const next = new Set(previous);
      if (next.has(anchor)) next.delete(anchor);
      else next.add(anchor);
      return next;
    });
    // Reading something is being done with it, so it folds away. Going back to
    // one is unticking it, which is the same gesture in reverse.
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (read.has(anchor)) next.delete(anchor);
      else next.add(anchor);
      return next;
    });
  };

  const readCount = rows.filter((row) => read.has(row.anchor)).length;
  const progress = describeReadProgress({
    total: rows.length,
    read: readCount,
  });
  const allCollapsed =
    rows.length > 0 && rows.every((row) => collapsed.has(row.anchor));

  /* The way back is the trail in the top bar — `Clinical / Change requests /
     Change 4 / Compare` — which every screen shares, so this one opens on its
     title like the rest. */
  const header = (
    <>
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">{title}</h1>
          {/* Who, what, and from where — the line a code host puts under a
              pull request's title. The branch is a link to that branch in
              the binder, because "from where" is a place you can go. */}
          {rows.length > 0 ? (
            <p className="cmp-byline">
              {status}
              {author ? <strong>{author}</strong> : "Somebody"}{" "}
              {describePublishIntent({ open, documents: rows.length })}
              {headRef ? (
                <>
                  {" from "}
                  {/* The branch's root, not its first file — the whole
                      binder as this change would leave it, which a change
                      that only archives has as much as any other. */}
                  <a
                    className="cmp-branch"
                    href={branchHref}
                    onClick={(event) => followInApp(event, onOpenBranch)}
                  >
                    <GitBranch
                      size={12}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    {headRef}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {/* Nothing to size is not a size. The states below say what this
              change does instead, at length — the scale line above them would
              be the same sentence, shorter and first. */}
          {rows.length > 0 ? (
            <p className="cmp-scale">
              {summarizeChangeScale({ rows, counts })}
            </p>
          ) : null}
        </div>
      </div>
      {tabs}
    </>
  );

  if (rows.length === 0) {
    return (
      <article className="change-compare">
        <div className="change-main">
          {header}
          <p className="bs-note">
            This change versions no document — it changes the binder's sign-off
            rules, which publishes nothing. The change itself says what it would
            do to them.
          </p>
        </div>
      </article>
    );
  }

  if (headRef === null) {
    return (
      <article className="change-compare">
        <div className="change-main">
          {header}
          <p className="bs-note">
            This change has no branch on record, so there is nothing to read the
            documents against.
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="change-compare">
      {header}

      <div
        className={`cmp-layout${rows.length > 1 ? " cmp-layout--tree" : ""}`}
      >
        {/* The tree: only what changed, folder by folder, each one a click
            away. One document is not a list, and a tree pointing at a single
            entry is furniture — the same rule the grammar states for rails. */}
        {rows.length > 1 ? (
          <aside className="bs-rail cmp-tree">
            <nav className="bs-panel" aria-label="Documents in this change">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">Files</h2>
                {progress ? (
                  <span className="bs-row-meta cmp-tree-progress">
                    {progress}
                  </span>
                ) : null}
                <span className="bs-panel-bar-spacer" />
                {/* The control that acts on a list lives in the list's own bar. */}
                <button
                  className="bs-linkbtn"
                  type="button"
                  onClick={() =>
                    setCollapsed(
                      allCollapsed ? new Set<string>() : new Set(anchors),
                    )
                  }
                >
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </button>
              </div>

              <ol className="cmp-tree-list">
                {groups.map((group) => (
                  <li key={group.folder || "(top)"}>
                    {group.folder ? (
                      <span className="cmp-tree-folder">
                        <Folder
                          size={13}
                          strokeWidth={1.6}
                          aria-hidden="true"
                        />
                        {group.folder}
                      </span>
                    ) : null}
                    <ol className="bs-row-list">
                      {group.rows.map((row) => {
                        const isRead = read.has(row.anchor);
                        const on = active === row.anchor;
                        return (
                          <li key={row.anchor}>
                            <button
                              className={`bs-row${on ? " bs-row--on" : ""}${
                                isRead ? " cmp-rail-row--read" : ""
                              }`}
                              type="button"
                              aria-current={on ? "true" : undefined}
                              title={describeChangedKind(row.kind, open)}
                              onClick={() => goTo(row.anchor)}
                            >
                              <span
                                className={`bs-row-icon cmp-rail-icon--${row.kind}`}
                              >
                                {isRead ? (
                                  <Check
                                    size={14}
                                    strokeWidth={2}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <KindIcon kind={row.kind} />
                                )}
                              </span>
                              <span className="bs-row-body">
                                <span className="bs-row-name">{row.name}</span>
                              </span>
                              <WordCounts summary={counts.get(row.anchor)} />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        ) : null}

        <div className="cmp-stream" ref={streamRef}>
          {rows.map((row) => (
            <ChangedDocumentSection
              key={row.anchor}
              org={org}
              binder={binder}
              row={row}
              headRef={headRef}
              open={open}
              collapsed={collapsed.has(row.anchor)}
              mounted={near.has(row.anchor)}
              read={read.has(row.anchor)}
              summary={counts.get(row.anchor)}
              imageMode={imageModes.get(row.anchor) ?? "side-by-side"}
              register={registerSection}
              onSummary={onSummaryFor(row.anchor)}
              onToggle={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(row.anchor)) next.delete(row.anchor);
                  else next.add(row.anchor);
                  return next;
                })
              }
              onToggleRead={() => toggleRead(row.anchor)}
              onImageMode={(mode) =>
                setImageModes((previous) =>
                  new Map(previous).set(row.anchor, mode),
                )
              }
              fileHref={fileHref(row.slugPath)}
              onReadFile={() => onReadFile(row.slugPath)}
              onDownload={(gitRef) => onDownload(row, gitRef)}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

interface ChangedDocumentSectionProps {
  org: string;
  binder: string;
  row: ChangedDocumentRow;
  headRef: string;
  open: boolean;
  collapsed: boolean;
  /** Whether this one has come near enough for its files to be worth fetching. */
  mounted: boolean;
  read: boolean;
  summary: ComparisonSummary | null | undefined;
  imageMode: ImageMode;
  register: (anchor: string, node: HTMLElement | null) => void;
  onSummary: (summary: ComparisonSummary | null) => void;
  onToggle: () => void;
  onToggleRead: () => void;
  onImageMode: (mode: ImageMode) => void;
  /** Where View goes: this document's proposed file, on the change's branch. */
  fileHref: string;
  onReadFile: () => void;
  onDownload: (gitRef: string) => void;
}

/**
 * The document's address, as the bar draws it — and, when the change moves
 * or renames it, both addresses: the old one struck out in red and the new
 * one in green, the way a diff draws any other line that changed. A sentence
 * saying "Moved from Nursing" under the bar was one more line to read to
 * learn what the path itself can show.
 */
function FilePath({ row }: { row: ChangedDocumentRow }): ReactNode {
  if (!row.previousSlugPath) {
    return <span className="cmp-file-path">{row.slugPath}</span>;
  }
  return (
    <>
      <del className="cmp-file-path cmp-file-path--old">
        {row.previousSlugPath}
      </del>
      <span className="cmp-file-path-arrow" aria-hidden="true">
        →
      </span>
      <ins className="cmp-file-path cmp-file-path--new">{row.slugPath}</ins>
      {/* A strike-through is invisible to a screen reader. */}
      {row.move ? <span className="sr-only">{row.move}</span> : null}
    </>
  );
}

/**
 * One document's place in the change: what is happening to it, and the proof.
 *
 * Three shapes, because a change does three things to a document and only one
 * of them is a diff. A revision is read against the version it replaces. A new
 * document has nothing to be read against, so it is simply read — which is
 * what a reviewer wants from a policy nobody has seen before. A removal has no
 * file on the branch at all; what it has is a last version on record, and the
 * honest thing to show is what is coming off.
 */
function ChangedDocumentSection({
  org,
  binder,
  row,
  headRef,
  open,
  collapsed,
  mounted,
  read,
  summary,
  imageMode,
  register,
  onSummary,
  onToggle,
  onToggleRead,
  onImageMode,
  fileHref,
  onReadFile,
  onDownload,
}: ChangedDocumentSectionProps) {
  /**
   * **The file path, which carries the identity — not the address.**
   *
   * A comparison reads at two refs: the proposed version on the change's
   * branch and the version it replaces on the base. A change that renames a
   * policy has two different addresses for one document, and the base ref has
   * never heard of the new one — so reading by address 404s on exactly the
   * change this screen exists to explain, and the diff came back "a browser
   * cannot read inside these files". The identity is the thing that is the
   * same at both (ADR 0005), and it rides in the filename.
   */
  const scope = useMemo<ChangeScope>(
    () => ({ org, binder, documentPath: row.path || row.slugPath }),
    [org, binder, row.path, row.slugPath],
  );

  // Stable per document, so the preview loads its file once rather than once
  // per render — the note on `DocumentPreview.loadFile` says what it costs.
  const loadFile = useCallback(
    (gitRef: string) => downloadDocument(scope, gitRef),
    [scope],
  );

  const badge = describeChangedBadge(row.kind, open);
  const comparesImages =
    (row.kind === "revised" || row.kind === "restored") &&
    row.base !== null &&
    classifyDocumentFile(row.fileName) === "image";
  // What Download saves: the proposed file, or — for a removal, which has
  // none — the last version on record. Nothing at all for a removal that
  // never published one.
  const downloadRef =
    row.kind === "removed" ? (row.base?.ref ?? null) : headRef;

  return (
    <section
      className={`bs-panel cmp-file${read ? " cmp-file--read" : ""}`}
      id={row.anchor}
      data-anchor={row.anchor}
      ref={(node) => register(row.anchor, node)}
      aria-label={`${row.name} — ${describeChangedKind(row.kind, open)}`}
    >
      {/* **Everything about this document, in one bar.** What it is, what is
          happening to it, and every act on it — so the bar that follows the
          reader down a long diff is also the one with the buttons in it. */}
      <header className="bs-panel-bar cmp-file-head">
        <button
          className="cmp-file-fold"
          type="button"
          aria-expanded={!collapsed}
          aria-controls={`${row.anchor}-body`}
          onClick={onToggle}
        >
          <ChevronDown
            className={collapsed ? "cmp-file-chevron--shut" : undefined}
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="sr-only">
            {collapsed ? `Show ${row.name}` : `Hide ${row.name}`}
          </span>
        </button>

        <h2 className="cmp-file-title">
          <FilePath row={row} />
        </h2>

        <WordCounts summary={summary} />

        <span className="bs-row-meta cmp-file-step">{row.versionStep}</span>

        {badge ? (
          <span className={`bs-status bs-status--sm cmp-kind--${row.kind}`}>
            <KindIcon kind={row.kind} />
            {badge}
          </span>
        ) : null}

        <span className="bs-panel-bar-spacer" />

        {comparesImages && !collapsed ? (
          <span
            className="doc-compare-modes"
            role="group"
            aria-label="How to compare"
          >
            <button
              className={`doc-compare-mode${imageMode === "side-by-side" ? " doc-compare-mode--on" : ""}`}
              type="button"
              aria-pressed={imageMode === "side-by-side"}
              onClick={() => onImageMode("side-by-side")}
            >
              <Columns2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Side by side
            </button>
            <button
              className={`doc-compare-mode${imageMode === "difference" ? " doc-compare-mode--on" : ""}`}
              type="button"
              aria-pressed={imageMode === "difference"}
              onClick={() => onImageMode("difference")}
            >
              <Layers size={13} strokeWidth={1.75} aria-hidden="true" />
              Difference
            </button>
          </span>
        ) : null}

        {/* A bookmark for this sitting, never a review: the record of who
            approved what is in Gitea, and the approve button is on the
            change. */}
        <button
          className={`cmp-file-read${read ? " cmp-file-read--on" : ""}`}
          type="button"
          aria-pressed={read}
          onClick={onToggleRead}
        >
          <Check size={13} strokeWidth={2} aria-hidden="true" />
          Viewed
        </button>

        {/* The exact file on the exact branch — a link, so it opens in a new
            tab and can be sent. A removal has no file on the branch. */}
        {row.kind === "removed" ? null : (
          <a
            className="bs-btn bs-btn--sm bs-btn-secondary cmp-file-act"
            href={fileHref}
            onClick={(event) => followInApp(event, onReadFile)}
          >
            <Eye size={14} strokeWidth={1.6} aria-hidden="true" />
            View
          </a>
        )}

        {downloadRef === null ? null : (
          <button
            className="bs-btn bs-btn--sm bs-btn-secondary cmp-file-act"
            type="button"
            onClick={() => onDownload(downloadRef)}
          >
            <Download size={14} strokeWidth={1.6} aria-hidden="true" />
            Download
          </button>
        )}
      </header>

      <div
        className="cmp-file-body"
        id={`${row.anchor}-body`}
        hidden={collapsed}
      >
        {collapsed ? null : !mounted ? (
          // A placeholder with the section's own height, so collapsing and
          // scrolling do not make the page jump under the reader.
          <p className="cmp-file-waiting">Ready when you scroll to it.</p>
        ) : row.kind === "removed" ? (
          /* A tinted block, which the grammar keeps for consequences — and a
             document leaving the record is the one consequence on this page
             that no diff can draw. */
          <div className="bs-note cmp-removed">
            <p className="cmp-removed-line">
              {open ? "This change archives " : "This change archived "}
              <strong>{row.name}</strong>.{" "}
              {row.base
                ? `Nothing is lost: ${row.base.label} and every version before it stay in the history, and can still be read, exported and restored.`
                : "It never published a version, so there is nothing on the record to keep."}
            </p>
          </div>
        ) : row.base === null ? (
          // New: nothing to read it against, so it is read whole. The badge
          // in the bar already says why there is no diff.
          <DocumentPreview
            loadFile={loadFile}
            gitRef={headRef}
            fileName={row.fileName}
            downloading={false}
            onDownload={() => onDownload(headRef)}
            bare
          />
        ) : (
          <DocumentComparison
            scope={scope}
            base={row.base}
            headRef={headRef}
            headLabel={open ? "This change" : "What it published"}
            fileName={row.fileName}
            imageMode={imageMode}
            onDownload={onDownload}
            onSummary={onSummary}
          />
        )}
      </div>
    </section>
  );
}
