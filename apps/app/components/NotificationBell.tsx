import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  CheckCheck,
  CircleCheck,
  GitPullRequest,
  UserCheck,
  X,
} from "lucide-react";

import {
  fetchNotificationCount,
  fetchNotifications,
  markNotificationsRead,
  type AppNotification,
} from "../api";
import { formatAge } from "../documentDisplay";
import {
  NOTIFICATIONS_CHANGED,
  announceNotificationsChanged,
} from "../notificationEvents";
import { describeNotification } from "../notificationText";

/**
 * The bell: what happened on the change requests you are part of.
 *
 * **Gitea's notifications, not ours** — see `services/api/notifications.ts`.
 * The number is the unread count Gitea keeps; the list is its threads, each
 * with the reason it is yours. Opening a change marks its notifications read,
 * the way reading an email does, so the bell never asks twice about the same
 * thing.
 *
 * Checked every minute and whenever the window comes back into focus — the
 * moment somebody returns from the email they were reading is the moment the
 * number should be right.
 */

const POLL_MS = 60_000;

const ICONS = {
  review_requested: UserCheck,
  your_change: GitPullRequest,
  published: CircleCheck,
  closed: X,
  activity: GitPullRequest,
} as const;

interface NotificationBellProps {
  /** Go to a change request. */
  onOpen: (href: string) => void;
}

export function NotificationBell({ onOpen }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [notes, setNotes] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const count = useCallback(() => {
    fetchNotificationCount()
      .then(setUnread)
      // A bell that cannot count stays quiet rather than showing an error on
      // every page.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    count();
    const timer = window.setInterval(count, POLL_MS);
    const onFocus = () => count();
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ unread?: number }>).detail?.unread;
      if (typeof next === "number") setUnread(next);
      else count();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [count]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(null);
    fetchNotifications(showAll)
      .then((list) => {
        if (!cancelled) setNotes(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFailed(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Your notifications could not be loaded. Try again in a moment.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, showAll]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
  };

  const openNote = (note: AppNotification) => {
    setOpen(false);
    if (note.unread) {
      void markNotificationsRead({ id: note.id })
        .then((result) => announceNotificationsChanged(result.unread))
        .catch(() => undefined);
    }
    onOpen(`/${note.org}/${note.binder}/-/changes/${note.changeNumber}`);
  };

  const markAll = () => {
    void markNotificationsRead("all")
      .then((result) => {
        announceNotificationsChanged(result.unread);
        setNotes(
          (list) => list?.map((note) => ({ ...note, unread: false })) ?? null,
        );
        if (!showAll) setNotes([]);
      })
      .catch(() => undefined);
  };

  const label =
    unread === 0
      ? "Notifications"
      : `Notifications, ${unread > 99 ? "99+" : unread} unread`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="app-topnav-icon-btn notif-bell"
        title="Notifications"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          place();
          setOpen((was) => !was);
        }}
      >
        <Bell size={16} strokeWidth={1.5} aria-hidden="true" />
        {unread > 0 ? (
          <span className="notif-badge" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open && anchor ? (
        <div
          ref={panelRef}
          className="app-menu notif-panel"
          role="dialog"
          aria-label="Notifications"
          style={{ top: anchor.top, right: anchor.right }}
        >
          <div className="notif-head">
            <span className="notif-title">Notifications</span>
            <span className="notif-filter" role="group" aria-label="Show">
              <button
                type="button"
                className={showAll ? "" : "is-on"}
                aria-pressed={!showAll}
                onClick={() => setShowAll(false)}
              >
                Unread
              </button>
              <button
                type="button"
                className={showAll ? "is-on" : ""}
                aria-pressed={showAll}
                onClick={() => setShowAll(true)}
              >
                All
              </button>
            </span>
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn--quiet notif-markall"
              disabled={unread === 0}
              onClick={markAll}
              title="Mark all as read"
            >
              <CheckCheck size={14} strokeWidth={1.5} aria-hidden="true" />
              Mark all read
            </button>
          </div>

          {failed ? (
            <p className="notif-empty">
              Your notifications could not be loaded. Try again in a moment.
            </p>
          ) : notes === null ? (
            <p className="notif-empty">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="notif-empty">
              {showAll
                ? "Nothing yet. When somebody asks for your review, or a change you are part of moves, it shows up here."
                : "You are all caught up."}
            </p>
          ) : (
            <ul className="notif-list">
              {notes.map((note) => {
                const Icon = ICONS[note.reason];
                return (
                  <li key={note.id}>
                    <a
                      className={`notif-row${note.unread ? " notif-row--unread" : ""}${
                        note.reason === "review_requested"
                          ? " notif-row--yours"
                          : ""
                      }`}
                      href={`/${note.org}/${note.binder}/-/changes/${note.changeNumber}`}
                      onClick={(event) => {
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.button !== 0
                        )
                          return;
                        event.preventDefault();
                        openNote(note);
                      }}
                    >
                      <Icon
                        className="notif-icon"
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <span className="notif-body">
                        <span className="notif-name">{note.title}</span>
                        <span className="notif-meta">
                          {describeNotification(note)} · {note.binder} ·{" "}
                          {formatAge(note.updatedAt)}
                        </span>
                      </span>
                      {note.unread ? (
                        <span className="notif-dot" aria-label="Unread" />
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}
