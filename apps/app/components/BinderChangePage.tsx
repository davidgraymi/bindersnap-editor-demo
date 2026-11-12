import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceChangeDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import { useMarkNotificationsRead } from "../data/notifications";
import { binderChangeQuery, queryKeys } from "../data/queries";
import {
  downloadBinderDocument,
  editBinderChange,
  setBinderChangeOpen,
  updateBinderChange,
} from "../api";
import { followInApp } from "../appLink";
import {
  binderChangeDetailToRecord,
  describeChangedDocument,
} from "../binderChange";
import { buildDocumentUrl, isEditorDocumentFile } from "../binderDocument";
import { buildBinderUrl } from "../binderShell";
import { buildChangedDocumentRows } from "../changedDocuments";
import type { ChangeScope } from "../changeScope";
import { formatDocumentName } from "../documentDisplay";
import type { DocumentChangeView } from "../routes";
import { nameFor, usePeopleNames } from "../usePeopleNames";
import { ChangeByline } from "./ChangeByline";
import { ChangeComparisonPage } from "./ChangeComparisonPage";
import { ChangeConflictsPage } from "./ChangeConflictsPage";
import { ChangeStateBadge, ChangeTabs } from "./ChangeTabs";
import { ApprovalRules } from "./ApprovalRules";
import { DocumentChangeDetail } from "./DocumentChangeDetail";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";
import { RuleChangeSection, RULE_CHANGE_ANCHOR } from "./RuleChangeSection";
import { PersonAvatar } from "./PersonAvatar";
import { routeToPath, type AppRoute } from "../routes";
import { formatShortDate } from "../documentDisplay";
import { describeGroupName } from "../../../packages/utils/groupName";
import {
  approvalCountsToward,
  ruleChangeCount,
  ruleChangeRows,
  rulesWarning,
  startsNextNote,
} from "../signOffChange";

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
  /**
   * Open a document in the editor, saving into this change: the author
   * answering a reviewer without starting a second change to do it.
   */
  onEditInEditor?: (slugPath: string) => void;
  /** Open the whole binder on this change's branch, at its root. */
  onOpenBranch: (branch: string) => void;
  /**
   * Where the branch chip goes when the branch is one of your drafts: the
   * draft itself, where you can keep working, rather than a read of it filed
   * under the change. Null when it is not yours.
   */
  ownDraftHref?: (branch: string) => string | null;
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
  ownDraftHref,
  onEditInEditor,
}: BinderChangePageProps) {
  const names = usePeopleNames(org);
  const queryClient = useQueryClient();
  const read = useQuery(binderChangeQuery(org, binder, changeNumber));
  const detail: WorkspaceChangeDetailPayload | null = read.data ?? null;
  const error = read.error
    ? read.error.message || "Unable to open this change."
    : null;
  /** Which of the change's documents the file screens are about. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);
  const [catchUpError, setCatchUpError] = useState<string | null>(null);

  /**
   * Read the change again after acting on it. Approving, publishing or
   * catching up all move the binder too — its lists and the counts in the tab
   * bar above — so everything about the binder is read again, not only this.
   */
  const load = useCallback(async () => {
    // Home and the review queue list this change too.
    void queryClient.invalidateQueries({ queryKey: queryKeys.homeChanges() });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.binder(org, binder),
    });
    onChanged();
  }, [queryClient, org, binder, onChanged]);

  // Having opened the change is having read what the bell said about it.
  const { mutate: markRead } = useMarkNotificationsRead();
  useEffect(() => {
    markRead({ change: { org, binder, number: changeNumber } });
  }, [org, binder, changeNumber, markRead]);

  useEffect(() => {
    setViewing(null);
  }, [org, binder, changeNumber]);

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
    () => (detail ? binderChangeDetailToRecord(detail) : null),
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
  const branchLabel = detail.branchLabel ?? null;
  const branchHref =
    (branchName ? ownDraftHref?.(branchName) : null) ??
    buildBinderUrl({
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

  // **What this change does to who signs off** (4.9–4.11), from the
  // server's rule diff: drawn first on the Changes tab, named in the byline,
  // and said at the moment of approval.
  const binderName = formatDocumentName(binder);
  const navigate = (route: AppRoute) => {
    window.history.pushState({}, "", routeToPath(route));
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const ruleChanges = detail.signOffChange?.rules ?? [];
  const changesRules = detail.signOffChange !== null && ruleChanges.length > 0;
  const ruleHref = `${changesHref}#${RULE_CHANGE_ANCHOR}`;
  const openRuleChange = () => {
    onViewChange("compare");
    window.setTimeout(
      () =>
        document
          .getElementById(RULE_CHANGE_ANCHOR)
          ?.scrollIntoView({ block: "start" }),
      300,
    );
  };
  const rulesOwnerNames = detail.approvalRules
    .filter((rule) => rule.reason.kind === "rules")
    .flatMap((rule) =>
      rule.groups.map((group) => `the ${describeGroupName(group)}`),
    );
  const startsNext = changesRules ? startsNextNote(ruleChanges) : null;
  const ruleSection = changesRules ? (
    <RuleChangeSection
      org={org}
      binder={binder}
      rows={ruleChangeRows(ruleChanges, binderName)}
      rulesOwners={
        rulesOwnerNames.length === 0
          ? null
          : rulesOwnerNames.length === 1
            ? rulesOwnerNames[0]!
            : `${rulesOwnerNames.slice(0, -1).join(", ")} and ${rulesOwnerNames[rulesOwnerNames.length - 1]}`
      }
      startsNext={startsNext}
      onNavigate={navigate}
    />
  ) : null;

  // Who each approver approves for, for "Approver · Policy Office": the
  // groups of the sign-off rules they can meet, at most two. The binder's
  // approvers list can name every group, and saying all of them says nothing.
  const approverGroups = new Map<string, string[]>();
  for (const rule of detail.approvalRules) {
    if (rule.kind !== "sign-off") continue;
    for (const user of rule.eligible) {
      const key = user.login.toLowerCase();
      const known = approverGroups.get(key) ?? [];
      for (const group of rule.groups) {
        if (!known.includes(group) && known.length < 2) known.push(group);
      }
      approverGroups.set(key, known);
    }
  }

  // Who publishing is waiting on: everyone eligible for an unmet rule.
  const unmet = detail.approvalRules.filter(
    (rule) => rule.approvedBy.length < rule.required,
  );
  const waitingOn = [
    ...new Map(
      unmet
        .flatMap((rule) =>
          rule.eligible.filter(
            (user) =>
              !rule.approvedBy.some((done) => done.login === user.login),
          ),
        )
        .map((user) => [user.login, nameFor(names, user.login)]),
    ).values(),
  ];
  const waitingLine =
    isOpen && unmet.length > 0
      ? `Publishing opens once every rule above is met.${
          waitingOn.length === 0
            ? " Nobody can meet them yet."
            : ` Waiting on ${
                waitingOn.length <= 1
                  ? waitingOn[0]
                  : waitingOn.length <= 3
                    ? `${waitingOn.slice(0, -1).join(", ")} and ${waitingOn[waitingOn.length - 1]}`
                    : `${waitingOn.slice(0, 3).join(", ")} and ${waitingOn.length - 3} ${waitingOn.length - 3 === 1 ? "other" : "others"}`
              }.`
        }`
      : null;
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
  const conflictsHref = buildBinderUrl({
    org,
    binder,
    tab: "changes",
    change: changeNumber,
    view: "conflicts",
  });

  /**
   * The documents that clash with the binder, and resolving them.
   *
   * Its own screen, like the comparison: resolving is reading two versions of
   * each document side by side, which a panel beside a discussion cannot hold.
   */
  if (view === "conflicts") {
    return (
      <ChangeConflictsPage
        key={changeNumber}
        org={org}
        binder={binder}
        changeNumber={changeNumber}
        title={record.summary}
        changeHref={buildBinderUrl({
          org,
          binder,
          tab: "changes",
          change: changeNumber,
        })}
        onBack={() => onViewChange("discussion")}
        onResolved={() => {
          onChanged();
          onViewChange("discussion");
          void load();
        }}
      />
    );
  }

  if (view === "compare") {
    return (
      <div className="binder-pane">
        <ChangeComparisonPage
          key={changeNumber}
          ruleSection={ruleSection}
          ruleCount={changesRules ? ruleChangeCount(ruleChanges) : null}
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
          branchLabel={branchLabel}
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
  /* **A clash is not a dead end.** A change whose documents were also
     changed in the binder cannot be merged by pressing a button, and saying
     only "Bring up to date" led straight to Gitea's refusal. When Gitea
     already knows it will clash, the way offered is the resolver; when it
     does not know yet and the update fails, the error offers it too. */
  const resolveLink = (
    <a
      className="bs-btn bs-btn--sm bs-btn-secondary"
      href={conflictsHref}
      onClick={(event) => followInApp(event, () => onViewChange("conflicts"))}
    >
      Resolve conflicts
    </a>
  );
  const behind =
    detail.isBehind && isOpen ? (
      <div className="bs-note bs-note--warn change-behind" role="status">
        {detail.hasConflicts ? (
          <p>
            <strong>
              The binder has moved on, and some of the same documents changed
              there too.
            </strong>{" "}
            Choose what each clash should say to bring this change up to date.
            {detail.clearsApprovalsOnEdit
              ? " That changes what it proposes, so approvals already given are cleared and asked for again."
              : " This binder keeps approvals already given through later edits."}
          </p>
        ) : (
          <p>
            <strong>The binder has moved on since this change was made.</strong>{" "}
            Updating it pulls in everything published since. What this change
            proposes stays the same, so approvals already given stay too.
          </p>
        )}
        {detail.hasConflicts ? (
          resolveLink
        ) : (
          <button
            className="bs-btn bs-btn--sm bs-btn-secondary"
            type="button"
            disabled={catchingUp}
            onClick={() => void runCatchUp()}
          >
            {catchingUp ? "Bringing up to date…" : "Bring up to date"}
          </button>
        )}
      </div>
    ) : null;

  return (
    <div className="binder-pane">
      {catchUpError ? (
        <div className="bs-note bs-note--danger change-behind" role="alert">
          <p>{catchUpError}</p>
          {resolveLink}
        </div>
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
            branchLabel={branchLabel}
            branchHref={branchHref}
            onOpenBranch={openBranch}
            openedAt={record.submittedAt}
            nameOf={nameOf}
            changesRules={changesRules}
            showFrom={false}
          />
        }
        aboutPanel={
          <section className="bs-panel" aria-labelledby="change-about">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title" id="change-about">
                About this change
              </h2>
            </div>
            <dl className="change-about">
              {branchName ? (
                <>
                  <dt>From</dt>
                  <dd>
                    <a
                      className="cmp-branch"
                      href={branchHref}
                      title={branchName}
                      onClick={(event) => followInApp(event, openBranch)}
                    >
                      <span className="cmp-branch-label">
                        {branchLabel ?? branchName}
                      </span>
                    </a>
                  </dd>
                </>
              ) : null}
              <dt>Opened</dt>
              <dd>
                {formatShortDate(record.submittedAt)} by{" "}
                {nameOf(record.submittedBy)}
              </dd>
              <dt>Assignee</dt>
              <dd>
                {detail.change.assignee ? (
                  <span className="change-about-person">
                    <PersonAvatar
                      person={detail.change.assignee}
                      size="sm"
                      card="Assignee on this change"
                    />
                    {nameOf(detail.change.assignee.login)}
                  </span>
                ) : (
                  "Nobody yet"
                )}
              </dd>
            </dl>
          </section>
        }
        waitingLine={waitingLine}
        approverGroups={approverGroups}
        approveNotes={
          changesRules
            ? {
                warning: rulesWarning(ruleChanges, binderName),
                countsToward: approvalCountsToward(
                  detail.approvalRules,
                  currentUser,
                ),
                ruleHref,
                onOpenRule: openRuleChange,
              }
            : null
        }
        banner={behind}
        /* No "What this change does" (D9): it repeated the Changes tab. */
        documentPicker={null}
        approvers={[
          ...new Set(
            detail.approvalRules.flatMap((rule) =>
              rule.eligible.map((user) => user.login),
            ),
          ),
        ]}
        approvalPanel={
          <ApprovalRules
            rules={detail.approvalRules}
            org={org}
            binderName={binderName}
            onNavigate={navigate}
            ruleChangeHref={ruleHref}
            onOpenRuleChange={openRuleChange}
            startsNext={startsNext}
          />
        }
        onOpenSignOffRules={onOpenSignOffRules}
        onEditSubject={async (subject) => {
          await editBinderChange(org, binder, changeNumber, subject);
          await load();
        }}
        onSetOpen={
          detail.viewer.canCloseOrReopen
            ? async (open) => {
                await setBinderChangeOpen(org, binder, changeNumber, open);
                // The binder's change list counts open changes, and the
                // author's draft is proposed or not by this.
                onChanged();
                await load();
              }
            : null
        }
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
        decisionRights={detail.viewer}
        nextVersion={shown?.nextVersion ?? 1}
        documentCount={documents.length}
        // A change that touches no document is a change to this binder's
        // sign-off rules — the one kind that goes through review and versions
        // nothing. Saying so replaces the version wording and the file panel,
        // both of which would otherwise be false.
        subject={
          shown || changesRules
            ? null
            : {
                title: "Who signs off on each folder",
                description:
                  "This change updates the binder's sign-off rules. It publishes no version.",
              }
        }
        documentName={
          shown
            ? formatDocumentName(shown.name)
            : changesRules
              ? "who signs off"
              : `this binder's rules`
        }
        onChanged={load}
        onViewChange={onViewChange}
        onBackToList={onBackToChanges}
      />
    </div>
  );
}
