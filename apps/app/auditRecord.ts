/**
 * The audit record, as a file somebody outside Bindersnap can read.
 *
 * The product's claim is that the approval trail is exportable for a regulator.
 * A regulator does not have a login, so the export cannot be a link into the
 * app, and it cannot be a screenshot either — it has to state who approved
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

/** What a verdict is called in the record. Bindersnap says "approved". */
const REVIEW_VERDICTS: Record<VersionReview["state"], string> = {
  approved: "Approved",
  changes_requested: "Requested changes",
  commented: "Commented",
  other: "Reviewed",
};

/**
 * Whether a review belongs in the record of a *published* version.
 *
 * A request for changes is a step on the way, not an outcome: the version
 * underneath it only exists because that request was answered and the change
 * was then approved. Printing it invites an auditor to ask what became of it,
 * and the answer is the version they are already holding. The approvals — and
 * what the approvers said — are what the record is for.
 */
function isRecordedReview(review: VersionReview): boolean {
  return review.state !== "changes_requested";
}

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
 * The qualifiers that decide whether an approval still counts.
 *
 * A stale or dismissed approval stays in the record — dropping it would be
 * editing history — but it has to be labelled, or the file reads as though the
 * version carried more approval than it did.
 */
function reviewQualifier(review: VersionReview): string {
  const notes: string[] = [];
  if (review.stale) notes.push("superseded by a later upload");
  if (review.dismissed) notes.push("dismissed");
  return notes.join(", ");
}

function renderReviewRows(allReviews: VersionReview[]): string {
  const reviews = allReviews.filter(isRecordedReview);
  if (reviews.length === 0) {
    return `<tr><td class="record-empty" colspan="4">No approvals were recorded on this change.</td></tr>`;
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

  // A version number is the whole identity a reader needs. The tag and the
  // commit underneath it are how Bindersnap stores that version, not what the
  // version is — and nobody reading this record can look either one up, so
  // printing them only invites a question the file cannot answer.
  const facts: [string, string][] = [
    ["Published", formatTimestamp(entry.createdAt) || "Unknown"],
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
    `<p class="record-version-label">Version ${entry.version}</p>`,
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
    // The owner, not "owner/repo" — the slug is a storage path, and the
    // document already has a name at the top of the page.
    ["Workspace", owner],
    [
      "Version on record",
      current ? `Version ${current.version}` : "None published",
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
/*
 * A printed document that happens to open in a browser.
 *
 * This ends up in an audit binder or attached to a regulator's email as a PDF,
 * so it is set like paper: black on white, hairline rules, no fills, nothing
 * that costs toner or reads as a web page. The brand lives in the typography —
 * the serif for headings, the sans for everything else — not in colour.
 */
:root {
  --ink: #000000;
  --ink-soft: #222222;
  --label: #444444;
  --rule: #000000;
  --hairline: #BBBBBB;
  --font-serif: 'Lora', Georgia, 'Times New Roman', serif;
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
}
@page { margin: 18mm; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32pt 24pt 48pt;
  background: #FFFFFF;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 10.5pt;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
}
main { max-width: 46em; margin: 0 auto; }
.record-eyebrow {
  margin: 0 0 6pt;
  font-size: 8pt;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--label);
}
h1 {
  font-family: var(--font-serif);
  font-size: 22pt;
  line-height: 1.15;
  font-weight: 700;
  margin: 0 0 8pt;
}
.record-lede {
  margin: 0 0 20pt;
  max-width: 62ch;
  color: var(--ink-soft);
}
/* The summary is the cover block: ruled off, not boxed in. */
.record-summary {
  border-top: 1.25pt solid var(--rule);
  border-bottom: 0.5pt solid var(--hairline);
  padding: 12pt 0;
  margin: 0 0 8pt;
}
.record-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150pt, 1fr));
  gap: 10pt 24pt;
  margin: 0 0 16pt;
}
.record-fact dt {
  font-size: 7.5pt;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--label);
  margin-bottom: 1pt;
}
.record-fact dd { margin: 0; word-break: break-word; }
.record-summary .record-facts { margin: 0; }
.record-version {
  border-top: 0.5pt solid var(--hairline);
  padding-top: 18pt;
  margin-top: 18pt;
  break-inside: avoid;
  page-break-inside: avoid;
}
.record-version-label {
  margin: 0 0 2pt;
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--label);
}
h2 {
  font-family: var(--font-serif);
  font-size: 15pt;
  font-weight: 700;
  line-height: 1.25;
  margin: 0 0 14pt;
}
table.record-reviews {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0;
}
table.record-reviews col.record-col-who { width: 24%; }
table.record-reviews col.record-col-verdict { width: 18%; }
table.record-reviews col.record-col-when { width: 22%; }
/* Repeat the column headings when a long trail runs onto a second page. */
table.record-reviews thead { display: table-header-group; }
table.record-reviews tr { break-inside: avoid; page-break-inside: avoid; }
table.record-reviews th {
  text-align: left;
  font-size: 7.5pt;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--label);
  border-bottom: 1pt solid var(--rule);
  padding: 0 10pt 4pt 0;
}
table.record-reviews td {
  vertical-align: top;
  padding: 7pt 10pt 7pt 0;
  border-bottom: 0.5pt solid var(--hairline);
  color: var(--ink-soft);
}
.record-stamp { white-space: normal; }
.record-note { color: var(--label); font-style: italic; }
.record-empty, .record-empty-state { color: var(--label); font-style: italic; }
footer {
  margin-top: 24pt;
  padding-top: 8pt;
  border-top: 0.5pt solid var(--hairline);
  color: var(--label);
  font-size: 8.5pt;
}
@media print {
  body { padding: 0; }
  h1, h2 { page-break-after: avoid; }
}
</style>
</head>
<body>
<main>
<p class="record-eyebrow">Audit record</p>
<h1>${escapeHtml(documentName)}</h1>
<p class="record-lede">Every published version of this document, who submitted it, who approved it, and when. A published version cannot be altered — changing the document means a new version, reviewed again.</p>
<div class="record-summary"><dl class="record-facts">${summaryRows}</dl></div>
${body}
<footer>Exported from Bindersnap. This record is generated from the document's version history; it is not editable and re-exporting reproduces it.</footer>
</main>
</body>
</html>
`;

  return { fileName: buildAuditRecordFileName(repo, generatedAt), html };
}
