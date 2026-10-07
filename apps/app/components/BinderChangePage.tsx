import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceChangeDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  editBinderChange,
  fetchBinderChange,
  updateBinderChange,
} from "../api";
import { followInApp } from "../appLink";
import { describeChangedDocument } from "../binderChange";
import { buildDocumentUrl } from "../binderDocument";
import { buildBinderUrl } from "../binderShell";
import { buildChangedDocumentRows } from "../changedDocuments";
import type { ChangeScope } from "../changeScope";
import { formatDocumentName, toChangeRecord } from "../documentDisplay";
import type { DocumentChangeView } from "../routes";
import { nameFor, usePeopleNames } from "../usePeopleNames";
import { ChangeByline } from "./ChangeByline";
import { ChangeComparisonPage } from "./ChangeComparisonPage";
import { ChangeStateBadge, ChangeTabs } from "./ChangeTabs";
import { DocumentChangeDetail } from "./DocumentChangeDetail";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * One change in a binder, at `/{org}/{binder}/-/changes/3`.
 *
 * The review itself is `DocumentChangeDetail` — the same discussion, timeline,
 * comparison, reviewer list and publish gate the per-document workspace has.
 * A change request is a Gitea pull request whether the thing it revises is a
 * repository of its own or a file inside a binder, so a second review screen
 * would only be a second set of wording to keep in step.
 *
 * What is genuinely a binder's own is above it: a change here can touch more
 * than one document, and it can fall behind the binder's `main`.
 */

interface BinderChangePageProps {
  org: string;
  binder: string;
  changeNumber: number;
  currentUser: string;
  view: DocumentChangeView;
  onViewChange: (view: DocumentChangeView) => void;
  onBackToChanges: () => void;
  /**
   * Open a document at its own address, on this change's branch.
   *
   * A change request is a branch, and a document on it has an address — so
   * "read what this proposes" is a navigation rather than a panel.
   */
  onOpenOnBranch: (slugPath: string, branch: string) => void;
  /** Open the whole binder on this change's branch, at its root. */
  onOpenBranch: (branch: string) => void;
  /** Something about the change moved: the binder's own counts have too. */
  onChanged: () => void;
  /** Where the required reviewers come from, for the reader who asks. */
  onOpenSignOffRules: () => void;
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function BinderChangePage({
  org,
  binder,
  changeNumber,
  currentUser,
  view,
  onViewChange,
  onBackToChanges,
  onChanged,
  onOpenSignOffRules,
  onOpenOnBranch,
  onOpenBranch,
}: BinderChangePageProps) {
  const names = usePeopleNames(org);
  const [detail, setDetail] = useState<WorkspaceChangeDetailPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** Which of the change's documents the file screens are about. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const [catchUpError, setCatchUpError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchBinderChange(org, binder, changeNumber));
      setError(null);
      // Approving, publishing or catching up all move the binder's own
      // counts, and the tab bar above is showing them.
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to open this change.",
      );
    }
  }, [org, binder, changeNumber, onChanged]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setViewing(null);
    void load();
  }, [load]);

  const documents = detail?.documents ?? [];
  // Held as a path rather than an index so the choice survives a refetch.
  const shown =
    documents.find((document) => document.slugPath === viewing) ??
    documents[0] ??
    null;

  const scope = useMemo<ChangeScope>(
    () => ({
      kind: "binder",
      org,
      binder,
      // **The file path, which carries the identity — not the address.** The
      // file operations on a change read at two refs: the proposed version on
      // the change's branch, and the version it replaces on the base. A change
      // that renames a policy has two different addresses for one document,
      // and the base ref has never heard of the new one. The identity is the
      // thing that is the same at both (ADR 0005), and it rides in the
      // filename.
      documentPath: shown?.path ?? shown?.slugPath ?? "",
    }),
    [org, binder, shown?.path, shown?.slugPath],
  );

  /**
   * An address still asking for the old in-page preview.
   *
   * **There is no in-page preview any more** — reading what a change proposes
   * happens at the document's own address on the change's branch, where it
   * has its own title and the whole width of the page. A link somebody saved
   * lands there rather than on a view that no longer exists.
   */
  useEffect(() => {
    if (view === "preview" && shown && detail?.change.branchName) {
      onOpenOnBranch(shown.slugPath, detail.change.branchName);
    }
    // `onOpenOnBranch` is a navigation closure over org and binder, both of
    // which change only by unmounting this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shown?.slugPath, detail?.change.branchName]);

  const record = useMemo(
    () =>
      detail
        ? {
            ...toChangeRecord(detail.change),
            // `toChangeRecord` serves the open-changes list, so it assumes
            // open. A decided change is not still awaiting a decision.
            open: detail.change.state === "open",
          }
        : null,
    [detail],
  );

  /**
   * Every document this change touches, versioned and retired alike.
   *
   * Built here rather than inside the comparison screen so the page above
   * already knows how many there are — the link to it can say so — and so the
   * comparison base is resolved per document. It used to be resolved once,
   * for whichever row happened to be selected, which is the same bug the
   * header's "becomes v2" had.
   */
  const comparisonRows = useMemo(
    () =>
      buildChangedDocumentRows({
        documents: detail?.documents ?? [],
        removedDocuments: detail?.removedDocuments ?? [],
        open: detail?.change.state === "open",
      }),
    [detail],
  );

  const runCatchUp = async () => {
    setCatchingUp(true);
    setCatchUpError(null);
    try {
      await updateBinderChange(org, binder, changeNumber);
      await load();
    } catch (err) {
      setCatchUpError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to bring this change up to date.",
      );
    } finally {
      setCatchingUp(false);
    }
  };

  /**
   * Download one document out of the comparison, at whichever ref it asks for.
   *
   * By identity: a download of the version being replaced is a read at a ref
   * that has never heard of a new name.
   */
  const handleRowDownload = async (
    row: { path: string; slugPath: string; fileName: string },
    gitRef: string,
  ) => {
    const blob = await downloadBinderDocument(
      org,
      binder,
      row.path || row.slugPath,
      gitRef,
    );
    triggerBrowserDownload(blob, row.fileName);
  };

  if (error) {
    return (
      <div className="binder-pane">
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
        <p>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onBackToChanges}
          >
            Back to change requests
          </button>
        </p>
      </div>
    );
  }

  if (!detail || !record) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Opening this change">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const isOpen = detail.change.state === "open";
  const nameOf = (login: string) => nameFor(names, login);
  const branchName = detail.change.branchName || null;
  const branchHref = buildBinderUrl({
    org,
    binder,
    ref: branchName,
    change: changeNumber,
  });
  const openBranch = () => {
    if (branchName) onOpenBranch(branchName);
  };

  /* **The same header on both screens**: whether the change is open, and the
     two tabs that are its two screens. A code host draws a merge request this
     way — Overview, Changes — and the comparison stops being a page you reach
     by a button in the rail and leave by the trail. */
  // A merged change reads as published; one closed without merging did not
  // publish, and the change alone does not say who ended it or why.
  const status = (
    <ChangeStateBadge
      state={
        isOpen
          ? "open"
          : detail.change.approvalState === "published"
            ? "published"
            : "closed"
      }
    />
  );
  const changesHref = buildBinderUrl({
    org,
    binder,
    tab: "changes",
    change: changeNumber,
    view: "compare",
  });
  const tabs = (
    <ChangeTabs
      view={view}
      overviewHref={buildBinderUrl({
        org,
        binder,
        tab: "changes",
        change: changeNumber,
      })}
      changesHref={changesHref}
      documentCount={comparisonRows.length}
      onSelect={onViewChange}
    />
  );

  /**
   * Everything this change does, on one screen.
   *
   * Its own screen rather than a panel on this one, and a full-width one: a
   * change that touches six documents is six comparisons, and a comparison in
   * half a column beside a discussion is a diff nobody can read.
   * `/-/changes/{n}/diffs` addresses it, so a reviewer can send "the diff"
   * rather than "open the change and press Compare".
   *
   * `key` on the change number, because everything the screen remembers —
   * which documents are folded, which are ticked, where the reader had got to
   * — is about *this* change and must not survive into the next one.
   */
  if (view === "compare") {
    return (
      <div className="binder-pane">
        <ChangeComparisonPage
          key={changeNumber}
          org={org}
          binder={binder}
          changeNumber={changeNumber}
          title={record.summary}
          open={isOpen}
          author={nameOf(record.submittedBy)}
          openedAt={record.submittedAt}
          nameOf={nameOf}
          rows={comparisonRows}
          headRef={detail.change.branchName || null}
          /* Arriving from a particular document's Compare button opens on that
             document rather than at the top of a page of six. */
          focusDocument={shown?.slugPath ?? null}
          /* The branch's root: the binder as this change would leave it. */
          branchHref={branchHref}
          onOpenBranch={openBranch}
          /* The same address `onOpenOnBranch` goes to, so View is a real link:
             it opens in a new tab and can be sent to somebody. */
          fileHref={(slugPath) =>
            buildDocumentUrl({
              org,
              binder,
              documentPath: slugPath,
              version: null,
              change: changeNumber,
              ref: detail.change.branchName || null,
            })
          }
          onReadFile={(slugPath) => {
            if (detail.change.branchName) {
              onOpenOnBranch(slugPath, detail.change.branchName);
            }
          }}
          onDownload={(row, gitRef) => void handleRowDownload(row, gitRef)}
          status={status}
          tabs={tabs}
        />
      </div>
    );
  }

  /**
   * What the page has to say before it can be acted on, if anything.
   *
   * **Not above the way back.** The stale-branch banner used to render before
   * the crumbs, so the first sentence on the page was about a state nobody had
   * told you you were in. It is drawn inside the review now, where the reader
   * has the change's own name first.
   */
  const behind =
    detail.isBehind && isOpen ? (
      <div className="bs-note bs-note--warn change-behind" role="status">
        <p>
          <strong>The binder has moved on since this change was made.</strong>{" "}
          Updating it pulls in everything published since. Approvals already
          given are dismissed, because they were for different content.
        </p>
        <button
          className="bs-btn bs-btn--sm bs-btn-secondary"
          type="button"
          disabled={catchingUp}
          onClick={() => void runCatchUp()}
        >
          {catchingUp ? "Bringing up to date…" : "Bring up to date"}
        </button>
      </div>
    ) : null;

  return (
    <div className="binder-pane">
      {catchUpError ? (
        <p className="bs-note bs-note--danger" role="alert">
          {catchUpError}
        </p>
      ) : null}

      <DocumentChangeDetail
        status={status}
        tabs={tabs}
        byline={
          <ChangeByline
            status={status}
            author={nameOf(record.submittedBy)}
            open={isOpen}
            documents={documents.length}
            branch={branchName}
            branchHref={branchHref}
            onOpenBranch={openBranch}
            openedAt={record.submittedAt}
            nameOf={nameOf}
          />
        }
        banner={behind}
        documentPicker={
          documents.length > 0 ? (
            /* **What this change does, document by document.** A change is the
               unit of approval and routinely touches several, and this panel
               was a picker rather than an answer: it showed the raw filename,
               identity segment and all, and left the one thing a reviewer
               wants — what happens to each — to a version string in the
               header that changed as you clicked. */
            <div className="bs-panel change-does">
              <div className="bs-panel-bar">
                <h2 className="bs-panel-bar-title">What this change does</h2>
                <span className="bs-panel-bar-spacer" />
                <span className="binder-count">
                  {documents.length === 1
                    ? "1 document"
                    : `${documents.length} documents`}
                </span>
              </div>
              <ul className="bs-row-list">
                {documents.map((document) => {
                  const facts = describeChangedDocument(document, !isOpen);
                  const anchor = comparisonRows.find(
                    (row) => row.slugPath === document.slugPath,
                  )?.anchor;

                  return (
                    <li key={document.slugPath}>
                      {/* **A way into its diff, not a selector.** Picking a
                          row used to repoint the rail at that document, so
                          seeing what changed was pick, then Compare — when
                          what a reviewer does is open Changes and scroll.
                          Each row now goes straight to its own place on
                          that screen. */}
                      <a
                        className="bs-row"
                        href={`${changesHref}${anchor ? `#${anchor}` : ""}`}
                        onClick={(event) =>
                          followInApp(event, () => {
                            setViewing(document.slugPath);
                            onViewChange("compare");
                          })
                        }
                      >
                        <span className="bs-row-body">
                          <span className="bs-row-name">{facts.title}</span>
                          {/* The address, not the file path: the identity
                              segment is a thing the server mints and nobody
                              reads. */}
                          <span className="bs-row-meta">{facts.address}</span>
                        </span>
                        <span className="bs-row-right">
                          {facts.move ? (
                            <span className="bs-status bs-status--working">
                              {facts.move}
                            </span>
                          ) : null}
                          <span className="bs-ver">{facts.effect}</span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null
        }
        requiredReviewers={detail.requiredReviewers.users}
        onOpenSignOffRules={onOpenSignOffRules}
        onEditSubject={async (subject) => {
          await editBinderChange(org, binder, changeNumber, subject);
          await load();
        }}
        scope={scope}
        currentUser={currentUser}
        isAnonymous={false}
        change={record}
        view={view}
        // The approvals whitelist is admin-only policy about named people, and
        // a binder's page does not ask for it. Null means "no restriction we
        // know of", and Gitea still refuses an approval that does not count.
        branchProtection={null}
        blockOnUnresolvedThreads={detail.blockOnUnresolvedThreads}
        canManageAssignments={detail.canManage}
        nextVersion={shown?.nextVersion ?? 1}
        documentCount={documents.length}
        // A change that touches no document is a change to this binder's
        // sign-off rules — the one kind that goes through review and versions
        // nothing. Saying so replaces the version wording and the file panel,
        // both of which would otherwise be false.
        subject={
          shown
            ? null
            : {
                title: "Who signs off on each folder",
                description:
                  "This change updates the binder's sign-off rules. It publishes no version.",
              }
        }
        documentName={
          shown ? formatDocumentName(shown.name) : `this binder's rules`
        }
        onChanged={load}
        onViewChange={onViewChange}
        onBackToList={onBackToChanges}
      />
    </div>
  );
}
