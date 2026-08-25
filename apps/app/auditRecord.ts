/**
 * The audit record, as a file somebody outside Bindersnap can read.
 *
 * The product's claim is that the approval trail is exportable for a regulator.
 * A regulator does not have a login, so the export cannot be a link into the
 * app, and it cannot be a screenshot either — it has to state who signed off on
 * every version, what they said, and when, in a document that opens on its own.
 *
 * So this builds one self-contained HTML file out of the history payload the
 * History tab already loaded. Nothing new is fetched and nothing is stored:
 * every fact in the file is a fact Gitea already holds, and re-exporting the
 * same document produces the same record. It prints to PDF straight from the
 * browser, which is how a record actually gets attached to an audit response.
 *
 * Pure on purpose. The component only hands it data and saves the result.
 */

import type { DocumentVersionRecord, VersionReview } from "./api";
import {
  capitalizeFirst,
  formatDocumentName,
  formatTimestamp,
  parseChangeTitle,
} from "./documentDisplay";

/** What a verdict is called in the record. */
const REVIEW_VERDICTS: Record<VersionReview["state"], string> = {
  approved: "Signed off",
  changes_requested: "Requested changes",
  commented: "Commented",
  other: "Reviewed",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AuditRecordInput {
  owner: string;
  repo: string;
  versions: DocumentVersionRecord[];
  /** When the export was taken. Passed in so the output is testable. */
  generatedAt: Date;
}

export interface AuditRecord {
  fileName: string;
  html: string;
}

/**
 * "quarterly-report-audit-record-2026-08-24.html".
 *
 * Dated because a record is a snapshot — two exports of the same document a
 * month apart are two different documents, and a regulator's folder should not
 * silently overwrite one with the other.
 */
export function buildAuditRecordFileName(
  repo: string,
  generatedAt: Date,
): string {
  const stamp = [
    generatedAt.getFullYear(),
    String(generatedAt.getMonth() + 1).padStart(2, "0"),
    String(generatedAt.getDate()).padStart(2, "0"),
  ].join("-");
  return `${repo}-audit-record-${stamp}.html`;
}

/** "Maya" — a login, made presentable, with the login kept alongside it. */
function personLabel(login: string | null | undefined): string {
  const trimmed = (login ?? "").trim();
  if (!trimmed) return "Unknown";
  return `${capitalizeFirst(trimmed)} (${trimmed})`;
}

function reviewerLabel(review: VersionReview): string {
  const login = review.author.login.trim();
  const fullName = review.author.fullName.trim();
  if (!login) return "Unknown";
  return `${fullName || capitalizeFirst(login)} (${login})`;
}

/**
 * The qualifiers that decide whether a sign-off still counts.
 *
 * A stale or dismissed approval stays in the record — dropping it would be
 * editing history — but it has to be labelled, or the file reads as though the
 * version carried more sign-off than it did.
 */
function reviewQualifier(review: VersionReview): string {
  const notes: string[] = [];
  if (review.stale) notes.push("superseded by a later upload");
  if (review.dismissed) notes.push("dismissed");
  return notes.join(", ");
}

function renderReviewRows(reviews: VersionReview[]): string {
  if (reviews.length === 0) {
    return `<tr><td class="record-empty" colspan="4">No reviews were recorded on this change.</td></tr>`;
  }

  return reviews
    .map((review) => {
      const qualifier = reviewQualifier(review);
      const verdict = REVIEW_VERDICTS[review.state];
      return [
        "<tr>",
        `<td>${escapeHtml(reviewerLabel(review))}</td>`,
        `<td>${escapeHtml(verdict)}${
          qualifier
            ? ` <span class="record-note">(${escapeHtml(qualifier)})</span>`
            : ""
        }</td>`,
        `<td class="record-stamp">${escapeHtml(formatTimestamp(review.submittedAt) || "Unknown")}</td>`,
        `<td>${review.body.trim() ? escapeHtml(review.body.trim()) : '<span class="record-note">No comment</span>'}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
}

function renderVersion(entry: DocumentVersionRecord): string {
  const submission = entry.submission;
  const title = submission
    ? parseChangeTitle(submission.body, submission.submittedBy)
    : `Version ${entry.version}`;

  const facts: [string, string][] = [
    ["Published", formatTimestamp(entry.createdAt) || "Unknown"],
    ["Tag", entry.tagName],
    ["Commit", entry.sha],
  ];

  if (submission) {
    facts.push(
      ["Change", `#${submission.number}`],
      ["Submitted by", personLabel(submission.submittedBy)],
      ["Submitted", formatTimestamp(submission.submittedAt) || "Unknown"],
      ["Published by", personLabel(submission.mergedBy)],
    );
  } else {
    // A version with no surviving change record is still on the record. Saying
    // so is the honest answer; leaving the rows out looks like an omission.
    facts.push(["Change", "No change record survives for this version"]);
  }

  facts.push([
    "Discussion",
    entry.discussionCount === 1
      ? "1 comment"
      : `${entry.discussionCount} comments`,
  ]);

  const factRows = facts
    .map(
      ([label, value]) =>
        `<div class="record-fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");

  return [
    '<section class="record-version">',
    '<header class="record-version-head">',
    `<span class="record-version-tag">v${entry.version}</span>`,
    `<h2>${escapeHtml(title)}</h2>`,
    "</header>",
    `<dl class="record-facts">${factRows}</dl>`,
    '<table class="record-reviews">',
    '<colgroup><col class="record-col-who" /><col class="record-col-verdict" /><col class="record-col-when" /><col /></colgroup>',
    "<thead><tr><th>Reviewer</th><th>Verdict</th><th>When</th><th>Comment</th></tr></thead>",
    `<tbody>${renderReviewRows(entry.reviews)}</tbody>`,
    "</table>",
    "</section>",
  ].join("");
}

/**
 * The exported record.
 *
 * Styles are inlined and the values mirror `bindersnap-tokens.css` by name —
 * the file has to open with no network and no stylesheet next to it, so the
 * tokens come along as custom properties rather than as an import.
 */
export function buildAuditRecord(input: AuditRecordInput): AuditRecord {
  const { owner, repo, versions, generatedAt } = input;
  const documentName = formatDocumentName(repo);
  const newestFirst = [...versions].sort((a, b) => b.version - a.version);
  const current = newestFirst[0] ?? null;

  const summary: [string, string][] = [
    ["Workspace", `${owner}/${repo}`],
    // The tag is normally just "v3" — printing "v3 (v3)" is the same word
    // twice, so the tag only earns its parentheses when it differs.
    [
      "Version on record",
      current
        ? current.tagName === `v${current.version}`
          ? `v${current.version}`
          : `v${current.version} (${current.tagName})`
        : "None published",
    ],
    ["Published versions", String(newestFirst.length)],
    ["Exported", formatTimestamp(generatedAt.toISOString()) || "Unknown"],
  ];

  const summaryRows = summary
    .map(
      ([label, value]) =>
        `<div class="record-fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");

  const body =
    newestFirst.length === 0
      ? '<p class="record-empty-state">This document has no published versions yet, so there is nothing on the record.</p>'
      : newestFirst.map(renderVersion).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(documentName)} — audit record</title>
<style>
:root {
  --color-coral: #E85D26;
  --color-ink: #1C1917;
  --color-ink-mid: #44403C;
  --color-paper: #FAFAF7;
  --color-paper-warm: #F5F0E8;
  --color-muted: #78716C;
  --color-rule: #E7E5E4;
  --font-serif: 'Lora', Georgia, serif;
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 48px 24px 96px;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.6;
}
main { max-width: 820px; margin: 0 auto; }
.record-eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-coral);
  margin: 0 0 8px;
}
h1 {
  font-family: var(--font-serif);
  font-size: 34px;
  line-height: 1.2;
  margin: 0 0 8px;
}
.record-lede { color: var(--color-muted); margin: 0 0 32px; max-width: 60ch; }
.record-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px 24px;
  margin: 0 0 24px;
}
.record-fact dt {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
}
.record-fact dd { margin: 0; word-break: break-word; }
.record-summary {
  background: var(--color-paper-warm);
  border: 1px solid var(--color-rule);
  border-radius: 16px;
  padding: 24px;
  margin: 0 0 48px;
}
.record-summary .record-facts { margin: 0; }
.record-version {
  border-top: 1px solid var(--color-rule);
  padding: 32px 0 8px;
  break-inside: avoid;
}
.record-version-head { display: flex; align-items: baseline; gap: 12px; }
.record-version-tag {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--color-coral);
  border: 1px solid var(--color-rule);
  border-radius: 9999px;
  padding: 2px 10px;
  background: #FFFFFF;
}
h2 { font-family: var(--font-serif); font-size: 22px; margin: 0 0 16px; }
table.record-reviews { width: 100%; border-collapse: collapse; margin: 0 0 8px; table-layout: fixed; }
table.record-reviews col.record-col-who { width: 24%; }
table.record-reviews col.record-col-verdict { width: 20%; }
table.record-reviews col.record-col-when { width: 22%; }
table.record-reviews th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--color-rule);
  padding: 6px 12px 6px 0;
}
table.record-reviews td {
  vertical-align: top;
  padding: 10px 12px 10px 0;
  border-bottom: 1px solid var(--color-rule);
  color: var(--color-ink-mid);
}
.record-stamp { font-family: var(--font-mono); font-size: 12px; }
.record-note { color: var(--color-muted); font-style: italic; }
.record-empty, .record-empty-state { color: var(--color-muted); }
footer {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--color-rule);
  color: var(--color-muted);
  font-size: 13px;
}
@media print {
  body { background: #FFFFFF; padding: 0; font-size: 12px; }
  .record-summary { background: none; }
}
</style>
</head>
<body>
<main>
<p class="record-eyebrow">Audit record</p>
<h1>${escapeHtml(documentName)}</h1>
<p class="record-lede">Every published version of this document, who submitted it, who signed it off, and when. Each version is an immutable tag on the document's repository — the commit named below is the file that was approved.</p>
<div class="record-summary"><dl class="record-facts">${summaryRows}</dl></div>
${body}
<footer>Exported from Bindersnap. This record is generated from the document's version history; it is not editable and re-exporting reproduces it.</footer>
</main>
</body>
</html>
`;

  return { fileName: buildAuditRecordFileName(repo, generatedAt), html };
}
