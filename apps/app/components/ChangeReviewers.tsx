import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, MessageSquare, Plus, X } from "lucide-react";

import {
  listDocumentCollaborators,
  searchWorkspaceUsers,
  updateChangeAssignments,
} from "../api";
import type { ChangeReviewer } from "../api";
import type { ReviewerDisplayStatus } from "../documentDisplay";
import {
  capitalizeFirst,
  getReviewerDisplayName,
  getReviewerStatusLabel,
  resolveReviewerDisplayStatus,
} from "../documentDisplay";
import type { ChangeScope } from "../changeScope";
import { PersonAvatar } from "./PersonAvatar";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 6;
/** Enough names to pick from without the popover becoming a page of its own. */
const SUGGESTION_LIMIT = 8;

interface ChangeReviewersProps {
  /** Which repository this change lives in — a document's, or a binder. */
  scope: ChangeScope;
  pullNumber: number;
  /** Who submitted the change. They can never be one of its reviewers. */
  submittedBy: string;
  reviewers: ChangeReviewer[];
  /** The reader, so their own row reads "You" rather than their name. */
  currentUser: string;
  /**
   * Logins with at least one unresolved thread of their own on this change.
   * The server cannot see this without paying for the discussion on every
   * change in the list, so the page that already loaded it says so.
   */
  openThreadAuthors: ReadonlySet<string>;
  /** Whether this reader may change who has to sign the change off. */
  canManage: boolean;
  /** Refetch the change: reviewers are server state, not local state. */
  onChanged: () => void | Promise<void>;
}

interface UserOption {
  login: string;
  fullName: string;
  avatarUrl: string;
}

/**
 * The mark beside a name.
 *
 * A green check is the only loud one, because approval is the only thing on
 * this row that is finished. Everything else is quiet and grey — a reviewer
 * who has not answered yet is not a problem, they are just not done.
 */
const STATUS_ICONS: Record<ReviewerDisplayStatus, typeof Check> = {
  approved: Check,
  changes_requested: X,
  thread_open: MessageSquare,
  commented: MessageSquare,
  awaiting: Clock,
};

function readError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Who has to sign this change off, on one row.
 *
 * There is no assignee here, and there is not meant to be. Two names — "the
 * person answerable" and "the people whose sign-off it needs" — asked a reader
 * to hold a distinction the product never actually enforced. The reviewers are
 * the answer to "who is this waiting on", and their marks say which of them it
 * is still waiting on.
 */
export function ChangeReviewers({
  scope,
  pullNumber,
  submittedBy,
  reviewers,
  currentUser,
  openThreadAuthors,
  canManage,
  onChanged,
}: ChangeReviewersProps) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The people already on this document, offered before anyone types. */
  const [collaborators, setCollaborators] = useState<UserOption[]>([]);
  const searchRequestId = useRef(0);
  const sectionRef = useRef<HTMLDivElement | null>(null);

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
          scope,
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
  }, [scope, canManage]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const requestId = ++searchRequestId.current;

    if (!picking || debouncedQuery.length < 2) {
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
  }, [debouncedQuery, picking]);

  // A popover that only closes via the button that opened it is a trap; every
  // other menu on the page closes on Escape and on a click elsewhere.
  useEffect(() => {
    if (!picking) return;

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
  }, [picking]);

  function closePicker() {
    setPicking(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
  }

  async function save(next: string[]) {
    setBusy(true);
    setError(null);
    try {
      await updateChangeAssignments(scope, pullNumber, {
        reviewers: next,
      });
      closePicker();
      await onChanged();
    } catch (err) {
      setError(readError(err, "Unable to update this change's reviewers."));
    } finally {
      setBusy(false);
    }
  }

  /** Nobody reviews their own change, and nobody is listed twice. */
  const eligible = (user: UserOption) =>
    user.login !== submittedBy && !reviewerLogins.has(user.login);

  // Before two letters are typed the popover shows the document's own people;
  // after that it shows the whole workspace. Either way it shows *something*,
  // which is the difference between a menu and a dead text box.
  const searchingWorkspace = debouncedQuery.length >= 2;
  const options = (searchingWorkspace ? results : collaborators).filter(
    eligible,
  );

  return (
    <div className="rev-reviewers" ref={sectionRef}>
      <h3 className="rev-reviewers-label">Reviewers</h3>

      {reviewers.length === 0 ? (
        <p className="rev-reviewers-empty">
          Nobody has been asked to review this yet.
        </p>
      ) : (
        <ul className="rev-reviewer-list">
          {reviewers.map((reviewer) => {
            const status = resolveReviewerDisplayStatus(
              reviewer,
              openThreadAuthors,
            );
            const Icon = STATUS_ICONS[status];
            const name =
              reviewer.login === currentUser
                ? "You"
                : getReviewerDisplayName(reviewer);

            return (
              <li className="rev-reviewer" key={reviewer.login}>
                <PersonAvatar person={reviewer} size="md" />
                <span className="rev-reviewer-name">{name}</span>
                <span
                  className={`rev-reviewer-mark rev-reviewer-mark--${status}`}
                  title={getReviewerStatusLabel(status)}
                >
                  <Icon size={13} strokeWidth={2} aria-hidden="true" />
                  <span className="sr-only">
                    {getReviewerStatusLabel(status)}
                  </span>
                </span>
                {canManage ? (
                  <button
                    className="rev-reviewer-remove"
                    type="button"
                    disabled={busy}
                    title={`Withdraw the review request for ${getReviewerDisplayName(reviewer)}`}
                    onClick={() =>
                      void save(
                        reviewers
                          .filter(
                            (candidate) => candidate.login !== reviewer.login,
                          )
                          .map((candidate) => candidate.login),
                      )
                    }
                  >
                    <X size={12} strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only">
                      Remove {getReviewerDisplayName(reviewer)} as a reviewer
                    </span>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <div className="rev-reviewers-anchor">
          <button
            className="rev-btn rev-btn--pill"
            type="button"
            disabled={busy}
            aria-expanded={picking}
            aria-haspopup="true"
            onClick={() => (picking ? closePicker() : setPicking(true))}
          >
            <Plus size={11} strokeWidth={2} aria-hidden="true" />
            Add reviewer
          </button>

          {picking ? (
            <div className="rev-picker" role="group">
              <label className="sr-only" htmlFor="rev-reviewer-search">
                Search for a reviewer
              </label>
              <input
                id="rev-reviewer-search"
                className="rev-picker-input"
                type="search"
                autoComplete="off"
                autoFocus
                placeholder="Search people…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />

              {searching ? (
                <p className="rev-picker-hint">Searching…</p>
              ) : options.length > 0 ? (
                <>
                  {!searchingWorkspace ? (
                    <p className="rev-picker-hint">On this document</p>
                  ) : null}
                  <ul className="rev-picker-results">
                    {options.map((user) => (
                      <li key={user.login}>
                        <button
                          className="rev-picker-result"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void save([
                              ...reviewers.map((reviewer) => reviewer.login),
                              user.login,
                            ])
                          }
                        >
                          <PersonAvatar person={user} />
                          <span className="rev-picker-identity">
                            <span className="rev-picker-name">
                              {user.fullName.trim() ||
                                capitalizeFirst(user.login)}
                            </span>
                            <span className="rev-picker-login">
                              @{user.login}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="rev-picker-hint">
                  {searchingWorkspace
                    ? "Everyone matching that is already on this change."
                    : "Type a name to search the workspace."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="vault-pr-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
