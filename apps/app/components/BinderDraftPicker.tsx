import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  GitPullRequestArrow,
  Pencil,
  Plus,
} from "lucide-react";

import type {
  BinderDraftPayload,
  OwnDraft,
} from "../../../packages/api-schema/schemas/workspaces";
import { formatAge } from "../documentDisplay";
import { nameFor, usePeopleNames } from "../usePeopleNames";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";

/**
 * Which draft you are editing in, and the way to any of the others.
 *
 * **A person may have several drafts now** (D8), which is a model change the
 * customer asked for and the reason is about the record: two unrelated
 * reorganisations should not have to be proposed in one change request, and
 * approved or refused together, just because the same person did both.
 *
 * Several drafts need exactly one new piece of chrome, and this is it. It sits
 * in the tree's own bar where the draft is being edited, because "which of my
 * drafts am I in" is a question about the thing on screen rather than about
 * the binder.
 *
 * **Somebody else's draft is listed and inert.** Knowing that Carol is editing
 * this binder is what stops two people making the same folder twice; reading
 * what she has not proposed is not something a draft offers, and the row says
 * so in words rather than by being absent.
 */

interface BinderDraftPickerProps {
  /** Whose people the other editors are, for their names. */
  org: string;
  /** Every draft of yours, newest first, and everybody else's. */
  drafts: BinderDraftPayload["drafts"];
  others: BinderDraftPayload["others"];
  /** The branch being edited. */
  current: string;
  busy: boolean;
  onSwitch: (branch: string) => void;
  onStart: (name: string) => void | Promise<void>;
  onRename: (branch: string, name: string) => void | Promise<void>;
}

/** "3 changes · edited 4 minutes ago", and the singular when there is one. */
export function describeDraft(draft: OwnDraft): string {
  // **A draft with nothing in it has never been edited**, whatever its branch
  // says. A fresh branch's newest commit is `main`'s, so an empty draft made a
  // moment ago reported "edited 2 days ago" — a date about somebody else's
  // work, on a row about yours.
  if (draft.actCount === 0) return "Nothing in it yet";

  const changes =
    draft.actCount === 1 ? "1 change" : `${draft.actCount} changes`;
  const when = draft.updatedAt
    ? `edited ${formatAge(draft.updatedAt)}`
    : "not edited yet";
  return `${changes} · ${when}`;
}

/** How wide the floating menu is, and how much room it needs below. */
const MENU_WIDTH = 340;
const MENU_MAX_HEIGHT = 360;

export function BinderDraftPicker({
  org,
  drafts,
  others,
  current,
  busy,
  onSwitch,
  onStart,
  onRename,
}: BinderDraftPickerProps) {
  const names = usePeopleNames(org);
  const [open, setOpen] = useState(false);
  /** Set while naming: a new draft, or one being renamed. */
  const [naming, setNaming] = useState<{
    kind: "new" | "rename";
    branch: string;
    value: string;
  } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Where the menu sits on the page, in viewport coordinates.
   *
   * **It floats rather than being laid out**, for the same reason the reviewer
   * picker does: this button lives in a `.bs-panel`'s bar, and a panel is a
   * squircle — `overflow: hidden` is what rounds its corners, and it cut this
   * menu off mid-row.
   */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const mine = drafts.find((draft) => draft.branch === current) ?? null;

  // Every other menu on the page closes on Escape and on a click elsewhere,
  // and one that only closes by its own button is a trap.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setNaming(null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        boxRef.current &&
        !boxRef.current.contains(target)
      ) {
        setOpen(false);
        setNaming(null);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  /** Keep the floating menu on its button as the page scrolls under it. */
  useEffect(() => {
    if (!open) return;

    const place = () => {
      const button = pickRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom;
      setAt({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top:
          below < MENU_MAX_HEIGHT && rect.top > below
            ? Math.max(8, rect.top - MENU_MAX_HEIGHT - 8)
            : rect.bottom + 6,
      });
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const commitName = async () => {
    if (!naming) return;
    const value = naming.value.trim();
    if (value === "") return;

    if (naming.kind === "new") await onStart(value);
    else await onRename(naming.branch, value);

    setNaming(null);
    setOpen(false);
  };

  return (
    <div className="bs-draftpicker" ref={boxRef}>
      <button
        type="button"
        className="bs-draftpick"
        ref={pickRef}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => {
          setOpen((was) => !was);
          setNaming(null);
        }}
      >
        <AppIcon icon={GitPullRequestArrow} size="sm" />
        {mine?.name ?? "Your draft"}
        {mine ? (
          <span className="bs-draftpick-count">
            · {mine.actCount === 1 ? "1 change" : `${mine.actCount} changes`}
          </span>
        ) : null}
        <AppIcon icon={ChevronDown} size="sm" />
      </button>

      {open ? (
        <div
          className="bs-draftmenu"
          role="menu"
          style={
            at
              ? { left: `${at.left}px`, top: `${at.top}px` }
              : { visibility: "hidden" }
          }
        >
          <div className="bs-panel-bar">
            <span className="bs-section-title">Your drafts</span>
          </div>

          {drafts.map((draft) => {
            const on = draft.branch === current;
            const renaming =
              naming?.kind === "rename" && naming.branch === draft.branch;

            return (
              <div
                className={`bs-row${on ? " bs-row--on" : ""}`}
                key={draft.branch}
              >
                <span className="bs-row-icon" aria-hidden="true">
                  {on ? <AppIcon icon={Check} size="sm" /> : null}
                </span>

                {renaming ? (
                  <input
                    className="bs-input bs-input--sm bs-draftname"
                    aria-label="What to call this draft"
                    autoFocus
                    value={naming.value}
                    disabled={busy}
                    onChange={(event) =>
                      setNaming({ ...naming, value: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void commitName();
                      if (event.key === "Escape") setNaming(null);
                    }}
                    onBlur={() => setNaming(null)}
                  />
                ) : (
                  <>
                    {/* The row is the switch. A draft you are already in is
                        still a button rather than a dead row, because a
                        disabled control beside three live ones reads as
                        broken rather than as "you are here" — the tick and
                        the highlight are what say that. */}
                    <button
                      type="button"
                      className="bs-row-body bs-draftmenu-pick"
                      disabled={busy}
                      onClick={() => {
                        setOpen(false);
                        if (!on) onSwitch(draft.branch);
                      }}
                    >
                      <span className="bs-row-name">{draft.name}</span>
                      <span className="bs-row-meta">
                        {describeDraft(draft)}
                      </span>
                    </button>
                    <span className="bs-rowacts">
                      <button
                        type="button"
                        className="bs-actionbtn"
                        aria-label={`Rename ${draft.name}`}
                        title="Rename"
                        disabled={busy}
                        onClick={() =>
                          setNaming({
                            kind: "rename",
                            branch: draft.branch,
                            value: draft.name,
                          })
                        }
                      >
                        <AppIcon icon={Pencil} size="sm" />
                      </button>
                    </span>
                  </>
                )}
              </div>
            );
          })}

          {/* Listed, and inert. Knowing somebody is editing is what stops two
              people making the same folder twice; reading their unproposed
              work is not what a draft offers, and the row says which of those
              two it is. */}
          {others.length > 0 ? (
            <>
              <div className="bs-panel-bar bs-draftmenu-split">
                <span className="bs-section-title">Also being edited</span>
              </div>
              {others.map((other) => (
                <div className="bs-row bs-row--muted" key={other.branch}>
                  <PersonAvatar
                    person={{
                      login: other.owner,
                      fullName: nameFor(names, other.owner),
                    }}
                    size="sm"
                  />
                  <span className="bs-row-body">
                    <span className="bs-row-name">
                      {nameFor(names, other.owner)}
                    </span>
                    <span className="bs-row-meta">
                      Editing this binder — you cannot see their draft
                    </span>
                  </span>
                </div>
              ))}
            </>
          ) : null}

          <div className="bs-panel-foot">
            {naming?.kind === "new" ? (
              <input
                className="bs-input bs-input--sm bs-draftname"
                aria-label="What to call the new draft"
                placeholder="Reorganise nursing"
                autoFocus
                value={naming.value}
                disabled={busy}
                onChange={(event) =>
                  setNaming({ ...naming, value: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commitName();
                  if (event.key === "Escape") setNaming(null);
                }}
              />
            ) : (
              /* Named on the way in, not afterwards. A draft with no name is
                 the thing this whole change exists to avoid: "resume the one
                 from Tuesday" has no answer when both are dates. */
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet bs-draftmenu-new"
                disabled={busy}
                onClick={() =>
                  setNaming({ kind: "new", branch: "", value: "" })
                }
              >
                <AppIcon icon={Plus} size="sm" />
                Start another draft
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
