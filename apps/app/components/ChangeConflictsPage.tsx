import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, FileText, GitMerge } from "lucide-react";

import type {
  ChangeConflictsPayload,
  ConflictingFilePayload,
} from "../../../packages/api-schema/schemas/workspaces";
import { sanitizeHtml } from "../../../packages/utils/sanitizer";
import { changeConflictsQuery } from "../data/queries";
import { resolveBinderChangeConflicts, updateBinderChange } from "../api";
import { followInApp } from "../appLink";
import {
  describeConflictFile,
  describeConflictName,
  displayConflictPath,
  emptyDecision,
  isDecided,
  planFileMerge,
  toResolution,
  type FileDecision,
  type FileMerge,
} from "../conflictResolution";
import { editorDocumentToHtml } from "../editorDocumentHtml";
import {
  base64ToBlob,
  type ConflictChoice,
  type MergeChunk,
} from "../threeWayMerge";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * Resolving a change that cannot be brought up to date on its own.
 *
 * **GitLab's merge-conflict page, for policies.** Every document the change
 * and the binder both changed since the change began is listed, and inside
 * each one only the places where the two disagree are put to the person:
 * this change's wording beside the published wording, and a button under
 * each. Everything that merged on its own is merged already and says so in
 * one line, because asking somebody to re-approve paragraphs nobody disagreed
 * about is how a resolver becomes a chore.
 *
 * **A policy written in the editor is resolved a paragraph at a time**, and
 * read as the policy it is — rendered, not as its JSON. A Word file or a PDF
 * cannot be merged by anybody's software, so it is chosen whole, with both
 * versions a click away to download and read.
 *
 * Nothing is written until every file is decided, and then all at once: the
 * change comes out up to date, with the resolution as a commit under the
 * resolver's name.
 */

interface ChangeConflictsPageProps {
  org: string;
  binder: string;
  changeNumber: number;
  /** The change's own title, for the reader who arrived by a link. */
  title: string;
  /** The change's page. */
  changeHref: string;
  onBack: () => void;
  /** Resolved, and up to date: back to the change, which has moved. */
  onResolved: () => void;
}

interface FileState {
  file: ConflictingFilePayload;
  merge: FileMerge;
}

export function ChangeConflictsPage({
  org,
  binder,
  changeNumber,
  title,
  changeHref,
  onBack,
  onResolved,
}: ChangeConflictsPageProps) {
  const read = useQuery(changeConflictsQuery(org, binder, changeNumber));
  const payload: ChangeConflictsPayload | null = read.data ?? null;
  const error = read.error
    ? read.error.message || "Unable to read what conflicts in this change."
    : null;
  const [decisions, setDecisions] = useState<Record<string, FileDecision>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const files: FileState[] = useMemo(
    () =>
      (payload?.files ?? []).map((file) => ({
        file,
        merge: planFileMerge(file),
      })),
    [payload],
  );

  useEffect(() => {
    setDecisions(
      Object.fromEntries(
        files.map(({ file, merge }) => [file.key, emptyDecision(merge)]),
      ),
    );
  }, [files]);

  const decide = (key: string, next: FileDecision) =>
    setDecisions((was) => ({ ...was, [key]: next }));

  const open = files.filter(
    ({ file, merge }) =>
      !isDecided(merge, decisions[file.key] ?? emptyDecision(merge)),
  ).length;
  // What is left to click, counted the way the page asks: each clash in a
  // document merged piece by piece, and a document chosen whole as one.
  const clashes = files.reduce((sum, { file, merge }) => {
    const decision = decisions[file.key] ?? emptyDecision(merge);
    if (isDecided(merge, decision)) return sum;
    if (merge.mode === "whole") return sum + 1;
    return sum + decision.pieces.filter((choice) => choice === null).length;
  }, 0);

  const submit = async () => {
    if (!payload) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resolutions = files.flatMap(({ file, merge }) => {
        const resolution = toResolution(
          file,
          merge,
          decisions[file.key] ?? emptyDecision(merge),
        );
        return resolution ? [resolution] : [];
      });
      await resolveBinderChangeConflicts(org, binder, changeNumber, {
        headSha: payload.headSha,
        baseSha: payload.baseSha,
        resolutions,
      });
      onResolved();
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to resolve this change's conflicts.",
      );
      setSubmitting(false);
    }
  };

  const head = (
    <header className="bs-pagehead">
      <div className="bs-pagehead-body">
        <h1 className="bs-title">Resolve conflicts</h1>
        <p className="bs-subtitle">
          <a href={changeHref} onClick={(event) => followInApp(event, onBack)}>
            {title}
          </a>{" "}
          · change {changeNumber}
        </p>
      </div>
    </header>
  );

  if (error) {
    return (
      <div className="binder-pane conflicts-page">
        {head}
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="binder-pane conflicts-page">
        {head}
        <SkeletonGroup label="Reading what conflicts">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  if (!payload.open || payload.upToDate || files.length === 0) {
    return (
      <div className="binder-pane conflicts-page">
        {head}
        <NothingToResolve
          payload={payload}
          org={org}
          binder={binder}
          changeNumber={changeNumber}
          onBack={onBack}
          onResolved={onResolved}
        />
      </div>
    );
  }

  const count = files.length;

  return (
    <div className="binder-pane conflicts-page">
      {head}

      <p className="conflicts-lede">
        {count === 1 ? "One document was" : `${count} documents were`} changed
        both in this change and in the binder since the change began, so it
        cannot be brought up to date on its own. Everything that did not clash
        is merged already; choose what each clash should say.
      </p>

      {payload.canResolve ? null : (
        <p className="bs-note" role="status">
          Only people who can edit this binder can resolve a change. You can
          read what conflicts here.
        </p>
      )}

      {files.map(({ file, merge }) => (
        <ConflictFile
          key={file.key}
          file={file}
          merge={merge}
          decision={decisions[file.key] ?? emptyDecision(merge)}
          disabled={!payload.canResolve || submitting}
          onDecide={(next) => decide(file.key, next)}
        />
      ))}

      {payload.canResolve ? (
        <div className="conflicts-bar" role="region" aria-label="Resolution">
          <div className="conflicts-bar-text">
            <strong>
              {open === 0
                ? "Every conflict is decided."
                : `${clashes} ${clashes === 1 ? "conflict still needs" : "conflicts still need"} a decision.`}
            </strong>{" "}
            <span className="conflicts-bar-why">
              This brings the change up to date. Approvals already given are
              dismissed, because they were for different content.
            </span>
          </div>
          {submitError ? (
            <p className="bs-note bs-note--danger" role="alert">
              {submitError}
            </p>
          ) : null}
          <div className="conflicts-bar-actions">
            <button
              type="button"
              className="bs-btn bs-btn-secondary"
              onClick={onBack}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              disabled={open > 0 || submitting}
              onClick={() => void submit()}
            >
              <GitMerge size={15} strokeWidth={1.75} aria-hidden="true" />
              {submitting ? "Resolving…" : "Resolve and bring up to date"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Up to date, closed, or behind with nothing in the way. */
function NothingToResolve({
  payload,
  org,
  binder,
  changeNumber,
  onBack,
  onResolved,
}: {
  payload: ChangeConflictsPayload;
  org: string;
  binder: string;
  changeNumber: number;
  onBack: () => void;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!payload.open || payload.upToDate) {
    return (
      <div className="bs-empty">
        <p>
          {payload.open
            ? "Nothing to resolve: this change is up to date with the binder."
            : "This change is no longer open, so there is nothing to resolve."}
        </p>
        <button
          type="button"
          className="bs-btn bs-btn-secondary bs-btn--sm"
          onClick={onBack}
        >
          Back to the change
        </button>
      </div>
    );
  }

  // Behind, but nothing clashes — Gitea's mergeable flag can lag a push.
  return (
    <div className="bs-empty">
      <p>
        Nothing in this change clashes with the binder. It can be brought up to
        date as it is.
      </p>
      {error ? (
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
      ) : null}
      {payload.canResolve ? (
        <button
          type="button"
          className="bs-btn bs-btn-primary bs-btn--sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            updateBinderChange(org, binder, changeNumber)
              .then(onResolved)
              .catch((err: unknown) => {
                setBusy(false);
                setError(
                  err instanceof Error
                    ? err.message
                    : "Unable to bring this change up to date.",
                );
              });
          }}
        >
          {busy ? "Bringing up to date…" : "Bring up to date"}
        </button>
      ) : null}
    </div>
  );
}

function ConflictFile({
  file,
  merge,
  decision,
  disabled,
  onDecide,
}: {
  file: ConflictingFilePayload;
  merge: FileMerge;
  decision: FileDecision;
  disabled: boolean;
  onDecide: (next: FileDecision) => void;
}) {
  const decided = isDecided(merge, decision);
  const conflicts =
    merge.mode === "pieces"
      ? merge.chunks.filter((chunk) => chunk.kind === "conflict").length
      : 0;
  // A file that can be merged in pieces can still be chosen whole, for the
  // resolver who knows one side is simply right.
  const [whole, setWhole] = useState(merge.mode === "whole");
  const named = describeConflictName(file.path);

  return (
    <section
      className={`bs-panel conflict-file${decided ? " conflict-file--decided" : ""}`}
      aria-label={displayConflictPath(file.path)}
    >
      <div className="bs-panel-bar conflict-file-bar">
        <FileText size={15} strokeWidth={1.75} aria-hidden="true" />
        <span
          className="conflict-file-name"
          title={displayConflictPath(file.path)}
        >
          {named.folder ? (
            <span className="conflict-file-folder">{named.folder} / </span>
          ) : null}
          <strong>{named.title}</strong>
          {named.extension ? (
            <span className="conflict-file-ext">.{named.extension}</span>
          ) : null}
        </span>
        <span className="bs-status bs-status--sm bs-status--review conflict-file-badge">
          {describeConflictFile(file)}
        </span>
        <span className="conflict-file-count">
          {merge.mode === "pieces" && !whole
            ? `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`
            : null}
        </span>
        {merge.mode === "pieces" ? (
          <button
            type="button"
            className="bs-btn bs-btn--sm bs-btn--quiet"
            disabled={disabled}
            onClick={() => {
              setWhole((was) => !was);
              onDecide({ ...decision, whole: null });
            }}
          >
            {whole ? "Resolve piece by piece" : "Choose a whole version"}
          </button>
        ) : null}
      </div>

      {merge.mode === "whole" && merge.reason === "automatic" ? (
        <p className="conflict-note">
          Moved in one version and edited in the other, so both hold: the edit
          is kept, at <code>{displayConflictPath(file.path)}</code>. Nothing to
          decide.
        </p>
      ) : whole || merge.mode === "whole" ? (
        <WholeChoice
          file={file}
          reason={merge.mode === "whole" ? merge.reason : null}
          value={decision.whole}
          disabled={disabled}
          onChange={(take) => onDecide({ ...decision, whole: take })}
        />
      ) : (
        <Pieces
          merge={merge}
          choices={decision.pieces}
          disabled={disabled}
          onChoose={(index, choice) => {
            const pieces = [...decision.pieces];
            pieces[index] = choice;
            onDecide({ ...decision, pieces });
          }}
        />
      )}
    </section>
  );
}

const WHOLE_REASONS: Record<string, string> = {
  binary:
    "A file like this cannot be merged by software, so one version is kept whole. Download both to compare them.",
  removed:
    "One side removed this document and the other changed it. Keep it, with its changes, or let it go.",
  "too-large":
    "This file is too large to compare on the page, so one version is kept whole. Download both to compare them.",
  unreadable:
    "This file could not be read on the page, so one version is kept whole.",
};

function WholeChoice({
  file,
  reason,
  value,
  disabled,
  onChange,
}: {
  file: ConflictingFilePayload;
  reason: string | null;
  value: FileDecision["whole"];
  disabled: boolean;
  onChange: (take: "ours" | "theirs" | "none") => void;
}) {
  const name = displayConflictPath(file.path).split("/").pop() ?? "document";
  const options: Array<{
    take: "ours" | "theirs" | "none";
    label: string;
    note: string;
    content: string | null;
  }> = [];
  if (file.ours) {
    options.push({
      take: "ours",
      label: "This change's version",
      note: "What the change proposed, as it stands.",
      content: file.ours.content,
    });
  }
  if (file.theirs) {
    options.push({
      take: "theirs",
      label: "The published version",
      note: "What the binder holds now; the change's edits to it are dropped.",
      content: file.theirs.content,
    });
  }
  if (!file.ours || !file.theirs) {
    options.push({
      take: "none",
      label: "Remove it",
      note: "As one side did. Its history stays.",
      content: null,
    });
  }

  return (
    <div className="conflict-whole">
      {reason && WHOLE_REASONS[reason] ? (
        <p className="conflict-note">{WHOLE_REASONS[reason]}</p>
      ) : null}
      <div
        className="conflict-whole-options"
        role="radiogroup"
        aria-label={`Which version of ${name} to keep`}
      >
        {options.map((option) => (
          <label key={option.take} className="bs-choice">
            <input
              type="radio"
              name={`whole-${file.key}`}
              checked={value === option.take}
              disabled={disabled}
              onChange={() => onChange(option.take)}
            />
            <span className="conflict-whole-body">
              <span className="bs-choice-name">{option.label}</span>
              <span className="bs-choice-note">{option.note}</span>
            </span>
            {option.content ? (
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet conflict-download"
                onClick={(event) => {
                  event.preventDefault();
                  download(option.content!, name, option.take);
                }}
              >
                <Download size={13} strokeWidth={1.75} aria-hidden="true" />
                Download
              </button>
            ) : null}
          </label>
        ))}
      </div>
    </div>
  );
}

function download(base64: string, name: string, side: string) {
  const url = URL.createObjectURL(base64ToBlob(base64));
  const anchor = document.createElement("a");
  const dot = name.lastIndexOf(".");
  anchor.href = url;
  anchor.download =
    dot > 0
      ? `${name.slice(0, dot)} (${side === "ours" ? "this change" : "published"})${name.slice(dot)}`
      : name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** The merged document: what settled in one line, each clash in full. */
function Pieces({
  merge,
  choices,
  disabled,
  onChoose,
}: {
  merge: Extract<FileMerge, { mode: "pieces" }>;
  choices: (ConflictChoice | null)[];
  disabled: boolean;
  onChoose: (index: number, choice: ConflictChoice) => void;
}) {
  let conflictIndex = -1;
  const unit = merge.format === "editor" ? "paragraph" : "line";

  return (
    <ol className="conflict-pieces">
      {(merge.chunks as MergeChunk<unknown>[]).map((chunk, index) => {
        if (chunk.kind === "settled") {
          const n = chunk.items.length;
          return (
            <li key={index} className="conflict-settled">
              {n} {unit}
              {n === 1 ? "" : "s"} the same, or merged without a clash
            </li>
          );
        }
        conflictIndex += 1;
        const at = conflictIndex;
        const choice = choices[at] ?? null;
        return (
          <li key={index} className="conflict-hunk">
            <div className="conflict-sides">
              <Side
                label="This change"
                items={chunk.ours}
                absent={
                  chunk.base.length === 0
                    ? "Not in this version."
                    : "Removed here."
                }
                format={merge.format}
                picked={choice === "ours" || choice === "both"}
                action={
                  <button
                    type="button"
                    className="bs-btn bs-btn--sm bs-btn-secondary"
                    aria-pressed={choice === "ours"}
                    aria-label="Use this change's wording"
                    disabled={disabled}
                    onClick={() => onChoose(at, "ours")}
                  >
                    Use this
                  </button>
                }
              />
              <Side
                label="Published since"
                items={chunk.theirs}
                absent={
                  chunk.base.length === 0
                    ? "Not in this version."
                    : "Removed here."
                }
                format={merge.format}
                picked={choice === "theirs" || choice === "both"}
                action={
                  <button
                    type="button"
                    className="bs-btn bs-btn--sm bs-btn-secondary"
                    aria-pressed={choice === "theirs"}
                    aria-label="Use the published wording"
                    disabled={disabled}
                    onClick={() => onChoose(at, "theirs")}
                  >
                    Use this
                  </button>
                }
              />
            </div>
            <div className="conflict-hunk-more">
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                aria-pressed={choice === "both"}
                disabled={disabled}
                onClick={() => onChoose(at, "both")}
              >
                Keep both
              </button>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                aria-pressed={choice === "neither"}
                disabled={disabled}
                onClick={() => onChoose(at, "neither")}
              >
                Keep neither
              </button>
              <span className="conflict-hunk-state" aria-live="polite">
                {choice === null
                  ? "Not decided"
                  : choice === "ours"
                    ? "This change's wording"
                    : choice === "theirs"
                      ? "The published wording"
                      : choice === "both"
                        ? "Both, this change's first"
                        : "Neither"}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Side({
  label,
  items,
  absent,
  format,
  picked,
  action,
}: {
  label: string;
  items: unknown[];
  /** What an empty side says: removed here, or never in this version. */
  absent: string;
  format: "editor" | "text";
  picked: boolean;
  action: ReactNode;
}) {
  return (
    <div className={`conflict-side${picked ? " conflict-side--picked" : ""}`}>
      <div className="conflict-side-head">
        <span className="conflict-side-label">{label}</span>
        {action}
      </div>
      {items.length === 0 ? (
        <p className="conflict-side-empty">{absent}</p>
      ) : format === "editor" ? (
        <Blocks blocks={items} />
      ) : (
        <pre className="conflict-side-text">
          {(items as string[]).join("\n")}
        </pre>
      )}
    </div>
  );
}

/** Blocks of a document the editor wrote, read as the policy they are. */
function Blocks({ blocks }: { blocks: unknown[] }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    editorDocumentToHtml(JSON.stringify({ type: "doc", content: blocks }))
      .then((rendered) => {
        if (!cancelled) setHtml(rendered ? sanitizeHtml(rendered) : "");
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [blocks]);

  if (html === null) return <SkeletonLine width="medium" />;
  return (
    <div
      className="conflict-side-prose doc-preview-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
