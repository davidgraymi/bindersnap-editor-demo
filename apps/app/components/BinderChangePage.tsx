import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceChangeDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  editBinderChange,
  fetchBinderChange,
  updateBinderChange,
} from "../api";
import { describeChangedDocument, describeMove } from "../binderChange";
import { buildDocumentUrl, downloadFileName } from "../binderDocument";
import { buildBinderUrl } from "../binderShell";
import { buildChangedDocumentRows } from "../changedDocuments";
import type { ChangeScope } from "../changeScope";
import { formatDocumentName, toChangeRecord } from "../documentDisplay";
import type { DocumentChangeView } from "../routes";
import { ChangeComparisonPage } from "./ChangeComparisonPage";
import { DocumentChangeDetail } from "./DocumentChangeDetail";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * One change in a binder, at `/{org}/{binder}?tab=changes&change=3`.
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
  onOpenDocument: (slugPath: string) => void;
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
  onOpenDocument,
  onChanged,
  onOpenSignOffRules,
  onOpenOnBranch,
  onOpenBranch,
}: BinderChangePageProps) {
  const [detail, setDetail] = useState<WorkspaceChangeDetailPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /** Which of the change's documents the file screens are about. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const [catchUpError, setCatchUpError] = useState<string | null>(null);
  const [downloadingRef, setDownloadingRef] = useState<string | null>(null);

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

  const handleDownload = async (gitRef: string, loaded?: Blob | null) => {
    if (!shown) return;
    setDownloadingRef(gitRef);
    try {
      const blob =
        loaded ??
        // By identity, for the same reason the scope is: a download of the
        // version this change replaces is a read at a ref that does not know
        // the new name.
        (await downloadBinderDocument(
          org,
          binder,
          shown.path || shown.slugPath,
          gitRef,
        ));
      triggerBrowserDownload(blob, downloadFileName(shown));
    } finally {
      setDownloadingRef(null);
    }
  };

  /**
   * Download one document out of the comparison, at whichever ref it asks for.
   *
   * Separate from {@link handleDownload} because that one is about the
   * document on screen, and on the comparison screen every document is on
   * screen. By identity for the same reason: a download of the version being
   * replaced is a read at a ref that has never heard of a new name.
   */
  const handleRowDownload = async (
    row: { path: string; slugPath: string; fileName: string },
    gitRef: string,
  ) => {
    setDownloadingRef(gitRef);
    try {
      const blob = await downloadBinderDocument(
        org,
        binder,
        row.path || row.slugPath,
        gitRef,
      );
      triggerBrowserDownload(blob, row.fileName);
    } finally {
      setDownloadingRef(null);
    }
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

  /**
   * Everything this change does, on one screen.
   *
   * Its own screen rather than a panel on this one, and a full-width one: a
   * change that touches six documents is six comparisons, and a comparison in
   * half a column beside a discussion is a diff nobody can read. `?view=compare`
   * addresses it, so a reviewer can send "the diff" rather than "open the
   * change and press Compare".
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
          author={record.submittedBy}
          rows={comparisonRows}
          headRef={detail.change.branchName || null}
          /* Arriving from a particular document's Compare button opens on that
             document rather than at the top of a page of six. */
          focusDocument={shown?.slugPath ?? null}
          onBackToChange={() => onViewChange("discussion")}
          /* The branch's root: the binder as this change would leave it. */
          branchHref={buildBinderUrl({
            org,
            binder,
            ref: detail.change.branchName || null,
            change: changeNumber,
          })}
          onOpenBranch={() => {
            if (detail.change.branchName) {
              onOpenBranch(detail.change.branchName);
            }
          }}
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
        banner={behind}
        documentPicker={
          documents.length > 1 ? (
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
                  {documents.length} documents
                </span>
                {/* **The list answers "what", this answers "what changed".**
                    Picking each row in turn and reading its diff was the only
                    way to see what a change did to all of it — the "which
                    version did we approve?" problem one level up. In the
                    list's own bar, because a control that acts on a list does
                    not float on the paper above it. */}
                <button
                  className="bs-linkbtn"
                  type="button"
                  onClick={() => onViewChange("compare")}
                >
                  See everything that changed →
                </button>
              </div>
              <ul className="bs-row-list">
                {documents.map((document) => {
                  const facts = describeChangedDocument(document, !isOpen);
                  const on = document.slugPath === shown?.slugPath;

                  return (
                    <li key={document.slugPath}>
                      <button
                        className={`bs-row${on ? " bs-row--on" : ""}`}
                        type="button"
                        aria-current={on ? "true" : undefined}
                        onClick={() => setViewing(document.slugPath)}
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
                      </button>
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
        /* **How many documents this change touches**, which decides whether
           the header may claim a version. "becomes v2 when published" sits
           under the change's own title, so with several documents it is a
           sentence about the change carrying a fact about whichever row
           happened to be selected — and it changed as you clicked between
           them. With more than one, the versions belong on the rows that own
           them and the header says nothing about any. */
        documentCount={documents.length}
        /* A rename is a change even when not a word of the document changed,
           and the comparison cannot show it. */
        documentMove={shown ? describeMove(shown) : null}
        onOpenOnBranch={
          shown && detail.change.branchName
            ? () => onOpenOnBranch(shown.slugPath, detail.change.branchName)
            : null
        }
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
        fileName={shown ? downloadFileName(shown) : null}
        downloading={downloadingRef !== null}
        onDownload={(gitRef, loaded) => void handleDownload(gitRef, loaded)}
        onChanged={load}
        onViewChange={onViewChange}
        onBackToList={onBackToChanges}
      />

      {shown ? (
        <p className="change-open-document">
          <button
            className="bs-linkbtn"
            type="button"
            onClick={() => onOpenDocument(shown.slugPath)}
          >
            Open {formatDocumentName(shown.name)} in the binder →
          </button>
        </p>
      ) : null}
    </div>
  );
}
