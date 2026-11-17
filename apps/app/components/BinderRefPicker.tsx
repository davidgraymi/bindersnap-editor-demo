import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppIcon, ICON } from "./AppIcon";

import { binderChangesQuery, binderDraftQuery } from "../data/queries";
import type {
  OwnDraft,
  WorkspaceChangeSummary,
} from "../../../packages/api-schema/schemas/workspaces";
import { describeBranch } from "../branchLabel";
import { nameFor, usePeopleNames } from "../usePeopleNames";

import { describeDraft } from "./BinderDraftPicker";
import { useFloatingMenu } from "./useFloatingMenu";

/**
 * Which version of the binder is on screen, and the way to any other.
 *
 * **GitLab's branch selector, over the tree.** The binder is a repository and
 * its page is the tree at a ref — the published record, or a change request's
 * branch, or your own draft. Without a selector the page said which one only
 * when it was *not* the record, so a reader had to know the difference to see
 * it; with one, every tree says what it is, and the record reads as a choice
 * among several rather than as the only thing there is.
 *
 * Three kinds of ref, in the order people reach for them: what is published,
 * what somebody has asked to change, and what you are still working on.
 * Somebody else's draft is not here — drafts are visible as existing and never
 * as contents, and the draft picker is where they are listed.
 *
 * **One branch, one row, one name.** A draft you have proposed is a branch
 * with a change request open on it: it is listed once, under Change requests,
 * as "Your draft", and not again under Your drafts. The button says what the
 * ticked row says — the change's title — so the menu, the button and the card
 * over the tree never call one branch three things.
 */

interface BinderRefPickerProps {
  org: string;
  binder: string;
  /** The branch the tree is read at. Null is the record. */
  current: string | null;
  /** Read the tree at another ref — null for the record. */
  onPick: (ref: string | null) => void;
  /** Read one of your drafts: a branch like the others, under its own name. */
  onPickDraft: (branch: string) => void;
}

/** What the button says: the record, or the branch in words. */
export function describeRef(
  ref: string | null,
  nameOf: (login: string) => string,
): string {
  return ref === null ? "Published" : describeBranch(ref, nameOf);
}

export function BinderRefPicker({
  org,
  binder,
  current,
  onPick,
  onPickDraft,
}: BinderRefPickerProps) {
  const names = usePeopleNames(org);
  const nameOf = (login: string) => nameFor(names, login);
  const [open, setOpen] = useState(false);
  const { boxRef, buttonRef, style } = useFloatingMenu(open, () =>
    setOpen(false),
  );

  // Read when first opened: most visits never open it, and the tree is what
  // they came for. Kept once read, so closing and reopening asks nothing.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (open) setAsked(true);
  }, [open]);
  const changes: WorkspaceChangeSummary[] =
    useQuery({
      ...binderChangesQuery(org, binder, "open"),
      // Also on a branch, to name it — see `label`.
      enabled: asked || current !== null,
    }).data?.changes ?? [];
  // No drafts to offer is an ordinary answer; failing to list them is not
  // worth a message inside a menu about something else.
  const drafts: OwnDraft[] =
    useQuery({
      ...binderDraftQuery(org, binder),
      // Also on a branch, which may be one of your drafts — see `label`.
      enabled: asked || current !== null,
    }).data?.drafts ?? [];

  const onCurrent =
    current === null
      ? undefined
      : changes.find((change) => change.branchName === current);
  /** One of your drafts, read as a branch: called what you called it. */
  const ownDraft =
    current === null
      ? undefined
      : drafts.find((draft) => draft.branch === current);
  const label =
    onCurrent?.title.trim() || ownDraft?.name || describeRef(current, nameOf);
  const yours = new Set(drafts.map((draft) => draft.branch));
  // Proposed ones are listed with the other change requests.
  const unproposed = drafts.filter((draft) => draft.changeNumber === null);
  const branches = changes.filter((change) => change.branchName);

  return (
    <div className="bs-draftpicker" ref={boxRef}>
      <button
        type="button"
        className={`bs-refpick${current === null ? "" : " bs-refpick--branch"}`}
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Version: ${label}`}
        title={current ?? "The published binder"}
        onClick={() => setOpen((was) => !was)}
      >
        <AppIcon
          icon={current === null ? ICON.onRecord : ICON.draft}
          size="sm"
        />
        <span className="bs-refpick-label">{label}</span>
        <AppIcon icon={ICON.chevronDown} size="sm" />
      </button>

      {open ? (
        <div className="bs-draftmenu" role="menu" style={style}>
          <RefRow
            on={current === null}
            name="Published"
            meta="What is in force now"
            onPick={() => {
              setOpen(false);
              if (current !== null) onPick(null);
            }}
          />

          <div className="bs-panel-bar bs-draftmenu-split">
            <span className="bs-section-title">Change requests</span>
          </div>
          {changes === null ? (
            <p className="bs-draftmenu-note">Loading…</p>
          ) : branches.length === 0 ? (
            <p className="bs-draftmenu-note">None open.</p>
          ) : (
            branches.map((change) => (
              <RefRow
                key={change.number}
                on={current === change.branchName}
                name={change.title}
                meta={`Change ${change.number} · ${
                  yours.has(change.branchName)
                    ? "Your draft"
                    : describeBranch(change.branchName, nameOf)
                }`}
                onPick={() => {
                  setOpen(false);
                  if (current !== change.branchName) onPick(change.branchName);
                }}
              />
            ))
          )}

          {unproposed.length > 0 ? (
            <>
              <div className="bs-panel-bar bs-draftmenu-split">
                <span className="bs-section-title">Your drafts</span>
              </div>
              {unproposed.map((draft) => (
                <RefRow
                  key={draft.branch}
                  on={current === draft.branch}
                  name={draft.name}
                  meta={describeDraft(draft)}
                  onPick={() => {
                    setOpen(false);
                    onPickDraft(draft.branch);
                  }}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RefRow({
  on,
  name,
  meta,
  onPick,
}: {
  on: boolean;
  name: string;
  meta: string;
  onPick: () => void;
}) {
  return (
    <div className={`bs-row${on ? " bs-row--on" : ""}`}>
      <span className="bs-row-icon" aria-hidden="true">
        {on ? <AppIcon icon={ICON.selected} size="sm" /> : null}
      </span>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={on}
        className="bs-row-body bs-draftmenu-pick"
        onClick={onPick}
      >
        <span className="bs-row-name">{name}</span>
        <span className="bs-row-meta">{meta}</span>
      </button>
    </div>
  );
}
