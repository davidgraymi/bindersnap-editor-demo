import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  MessageSquare,
  UserRound,
  X,
} from "lucide-react";

import {
  listDocumentCollaborators,
  searchWorkspaceUsers,
  updateChangeAssignments,
} from "../api";
import type { ChangeReviewer, ChangeUser } from "../api";
import type { ReviewerDisplayStatus } from "../documentDisplay";
import {
  capitalizeFirst,
  formatShortDate,
  getReviewerDisplayName,
  getReviewerStatusLabel,
  resolveReviewerDisplayStatus,
} from "../documentDisplay";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 6;
/** Enough names to pick from without the popover becoming a page of its own. */
const SUGGESTION_LIMIT = 8;

interface ChangeReviewersProps {
  owner: string;
  repo: string;
  pullNumber: number;
  /** Who submitted the change. They can never be one of its reviewers. */
  submittedBy: string;
  assignee: ChangeUser | null;
  reviewers: ChangeReviewer[];
  /**
   * Logins with at least one unresolved thread of their own on this change.
   * The server cannot see this without paying for the discussion on every
   * change in the list, so the page that already loaded it says so.
   */
  openThreadAuthors: ReadonlySet<string>;
  /** Whether this reader may change who the work sits with. */
  canManage: boolean;
  /** Refetch the change: assignments are server state, not local state. */
  onChanged: () => void | Promise<void>;
}

interface UserOption {
  login: string;
  fullName: string;
  avatarUrl: string;
}

/** Which of the two roles a popover is currently filling. */
type PickerKind = "assignee" | "reviewer";

const STATUS_ICONS: Record<ReviewerDisplayStatus, typeof CircleCheck> = {
  approved: CircleCheck,
  changes_requested: CircleX,
  thread_open: MessageSquare,
  commented: MessageSquare,
  awaiting: CircleDashed,
};

function readError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

function PersonAvatar({ person }: { person: UserOption }) {
  const name = person.fullName.trim() || person.login;

  if (person.avatarUrl) {
    return (
      <img
        className="reviewer-avatar"
        src={person.avatarUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className="reviewer-avatar reviewer-avatar--fallback"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/**
 * One reviewer, with the icon that says where they stand.
 *
 * The icon is the point: a reader scanning the list should be able to see who
 * is still holding the change up without reading a single word.
 */
function ReviewerRow({
  reviewer,
  status,
  canManage,
  busy,
  onRemove,
}: {
  reviewer: ChangeReviewer;
  status: ReviewerDisplayStatus;
  canManage: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const Icon = STATUS_ICONS[status];
  const name = getReviewerDisplayName(reviewer);
  const label = getReviewerStatusLabel(status);
  const reviewed = reviewer.reviewedAt
    ? formatShortDate(reviewer.reviewedAt)
    : null;

  return (
    <li className={`reviewer-row reviewer-row--${status}`}>
      <span className="reviewer-status-icon" title={label}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <PersonAvatar person={reviewer} />
      <span className="reviewer-identity">
        <span className="reviewer-name">{name}</span>
        <span className="reviewer-status-label">
          {label}
          {reviewer.stale && status === "approved"
            ? " — superseded by a later upload"
            : reviewed && status !== "awaiting"
              ? ` · ${reviewed}`
              : ""}
          {!reviewer.requested && status !== "awaiting"
            ? " · reviewed uninvited"
            : ""}
        </span>
      </span>
      {canManage ? (
        <button
          className="reviewer-remove"
          type="button"
          disabled={busy}
          title={`Withdraw the review request for ${name}`}
          onClick={onRemove}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">Remove {name} as a reviewer</span>
        </button>
      ) : null}
    </li>
  );
}

/**
 * Who this change is sitting with.
 *
 * A change with no name on it is a change nobody owns, and "awaiting review"
 * has never told anyone whose review. The assignee is the one person
 * answerable for getting it decided; the reviewers are the people whose
 * sign-off it needs. Both are Gitea primitives, so both are part of the record.
 */
export function ChangeReviewers({
  owner,
  repo,
  pullNumber,
  submittedBy,
  assignee,
  reviewers,
  openThreadAuthors,
  canManage,
  onChanged,
}: ChangeReviewersProps) {
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The people already on this document, offered before anyone types. */
  const [collaborators, setCollaborators] = useState<UserOption[]>([]);
  const searchRequestId = useRef(0);
  const sectionRef = useRef<HTMLElement | null>(null);

  const reviewerLogins = useMemo(
    () => new Set(reviewers.map((reviewer) => reviewer.login)),
    [reviewers],
  );

  // The people who can review this are overwhelmingly the people already on
  // the document, so the popover opens with them listed. Making someone type
  // two letters to reach a colleague they picked yesterday is the clunk.
  useEffect(() => {
    let cancelled = false;
    if (!canManage) return;

    void (async () => {
      try {
        const payload = await listDocumentCollaborators(
          owner,
          repo,
          1,
          SUGGESTION_LIMIT,
        );
        if (cancelled) return;
        setCollaborators(
          payload.collaborators
            .map((entry) => ({
              login: entry.user.login ?? "",
              fullName: entry.user.full_name ?? "",
              avatarUrl: entry.user.avatar_url ?? "",
            }))
            .filter((user) => user.login),
        );
      } catch {
        // A missing suggestion list is not worth an error banner: the search
        // box below it still reaches everyone in the workspace.
        if (!cancelled) setCollaborators([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, repo, canManage]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const requestId = ++searchRequestId.current;

    if (picker === null || debouncedQuery.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    void (async () => {
      try {
        const payload = await searchWorkspaceUsers(
          debouncedQuery,
          1,
          SEARCH_PAGE_SIZE,
        );
        if (requestId !== searchRequestId.current) return;
        setResults(
          payload.users
            .map((user) => ({
              login: user.login ?? "",
              fullName: user.full_name ?? "",
              avatarUrl: user.avatar_url ?? "",
            }))
            .filter((user) => user.login),
        );
      } catch (err) {
        if (requestId !== searchRequestId.current) return;
        setResults([]);
        setError(readError(err, "Unable to search for people right now."));
      } finally {
        if (requestId === searchRequestId.current) setSearching(false);
      }
    })();
  }, [debouncedQuery, picker]);

  // A popover that only closes via the button that opened it is a trap; every
  // other menu on the page closes on Escape and on a click elsewhere.
  useEffect(() => {
    if (picker === null) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePicker();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        sectionRef.current &&
        !sectionRef.current.contains(target)
      ) {
        closePicker();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [picker]);

  function closePicker() {
    setPicker(null);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
  }

  async function save(updates: {
    assignee?: string | null;
    reviewers?: string[];
  }) {
    setBusy(true);
    setError(null);
    try {
      await updateChangeAssignments(owner, repo, pullNumber, updates);
      closePicker();
      await onChanged();
    } catch (err) {
      setError(readError(err, "Unable to update this change's assignments."));
    } finally {
      setBusy(false);
    }
  }

  /** Nobody reviews their own change, and nobody is listed twice. */
  function eligible(user: UserOption, kind: PickerKind): boolean {
    return kind === "reviewer"
      ? user.login !== submittedBy && !reviewerLogins.has(user.login)
      : user.login !== assignee?.login;
  }

  // Before two letters are typed the popover shows the document's own people;
  // after that it shows the whole workspace. Either way it shows *something*,
  // which is the difference between a menu and a dead text box.
  const searching2Plus = debouncedQuery.length >= 2;
  const options = (searching2Plus ? results : collaborators).filter((user) =>
    picker === null ? false : eligible(user, picker),
  );

  function choose(user: UserOption) {
    void save(
      picker === "assignee"
        ? { assignee: user.login }
        : {
            reviewers: [
              ...reviewers.map((reviewer) => reviewer.login),
              user.login,
            ],
          },
    );
  }

  function renderPicker(kind: PickerKind) {
    if (picker !== kind) return null;

    return (
      <div className="change-assignments-picker" role="group">
        <label className="sr-only" htmlFor="change-assignment-search">
          {kind === "assignee"
            ? "Search for an assignee"
            : "Search for a reviewer"}
        </label>
        <input
          id="change-assignment-search"
          className="collaborator-search-input"
          type="search"
          autoComplete="off"
          autoFocus
          placeholder={
            kind === "assignee" ? "Search people…" : "Search people…"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {searching ? (
          <p className="change-assignments-hint">Searching…</p>
        ) : options.length > 0 ? (
          <>
            {!searching2Plus ? (
              <p className="change-assignments-hint">On this document</p>
            ) : null}
            <ul className="change-assignments-results">
              {options.map((user) => (
                <li key={user.login}>
                  <button
                    className="change-assignments-result"
                    type="button"
                    disabled={busy}
                    onClick={() => choose(user)}
                  >
                    <PersonAvatar person={user} />
                    <span className="reviewer-identity">
                      <span className="reviewer-name">
                        {user.fullName.trim() || capitalizeFirst(user.login)}
                      </span>
                      <span className="reviewer-status-label">
                        @{user.login}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="change-assignments-hint">
            {searching2Plus
              ? kind === "reviewer"
                ? "Everyone matching that is already on this change."
                : "Nobody matched that search."
              : "Type a name to search the workspace."}
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      className="change-assignments"
      aria-label="Reviewers"
      ref={sectionRef}
    >
      <div className="change-assignments-block">
        <h3 className="change-detail-section-title">Assignee</h3>
        {assignee ? (
          <div className="assignee-row">
            <PersonAvatar person={assignee} />
            <span className="reviewer-identity">
              <span className="reviewer-name">
                {assignee.fullName.trim() || capitalizeFirst(assignee.login)}
              </span>
              <span className="reviewer-status-label">
                Answerable for getting this decided
              </span>
            </span>
            {canManage ? (
              <button
                className="reviewer-remove"
                type="button"
                disabled={busy}
                title="Clear the assignee"
                onClick={() => void save({ assignee: null })}
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
                <span className="sr-only">Clear the assignee</span>
              </button>
            ) : null}
          </div>
        ) : (
          <p className="change-assignments-empty">
            <UserRound size={14} strokeWidth={1.5} aria-hidden="true" />
            Nobody is assigned.
          </p>
        )}

        {canManage ? (
          <div className="change-assignments-anchor">
            <button
              className="bs-btn bs-btn-secondary change-assignments-btn"
              type="button"
              disabled={busy}
              aria-expanded={picker === "assignee"}
              aria-haspopup="true"
              onClick={() =>
                picker === "assignee" ? closePicker() : setPicker("assignee")
              }
            >
              {assignee ? "Reassign" : "Assign someone"}
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {renderPicker("assignee")}
          </div>
        ) : null}
      </div>

      <div className="change-assignments-block">
        {/* No approval meter here: the change's header already carries it,
            and two of them 500px apart is the same fact twice. */}
        <h3 className="change-detail-section-title">Reviewers</h3>

        {reviewers.length === 0 ? (
          <p className="change-assignments-empty">
            <CircleDashed size={14} strokeWidth={1.5} aria-hidden="true" />
            Nobody has been asked to review this yet.
          </p>
        ) : (
          <ul className="reviewer-list">
            {reviewers.map((reviewer) => (
              <ReviewerRow
                key={reviewer.login}
                reviewer={reviewer}
                status={resolveReviewerDisplayStatus(
                  reviewer,
                  openThreadAuthors,
                )}
                canManage={canManage}
                busy={busy}
                onRemove={() =>
                  void save({
                    reviewers: reviewers
                      .filter((candidate) => candidate.login !== reviewer.login)
                      .map((candidate) => candidate.login),
                  })
                }
              />
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="change-assignments-anchor">
            <button
              className="bs-btn bs-btn-secondary change-assignments-btn"
              type="button"
              disabled={busy}
              aria-expanded={picker === "reviewer"}
              aria-haspopup="true"
              onClick={() =>
                picker === "reviewer" ? closePicker() : setPicker("reviewer")
              }
            >
              Add a reviewer
              <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {renderPicker("reviewer")}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="vault-pr-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
