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
 * same binder produces the same record. It prints to PDF straight from the
 * browser, which is how a record actually gets attached to an audit response.
 *
 * **It is a binder's record now, not one document's.** Under ADR 0004 a binder
 * is the policy manual and a `git clone` of it is the whole approval trail —
 * which is most of what the export was for. Exporting per document meant a
 * regulator asking for "your infection control policies" got one file per
 * policy; one file per binder is the shape they actually asked for.
 *
 * Pure on purpose. The component only hands it data and saves the result.
 */

import type { WorkspaceHistoryEntry } from "./api";
import { capitalizeFirst, formatTimestamp } from "./documentDisplay";

/** What a verdict is called in the record. Bindersnap says "approved". */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AuditRecordInput {
  organization: string;
  binder: string;
  /** Every published version in the binder, newest first. */
  versions: WorkspaceHistoryEntry[];
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

function renderVersion(entry: WorkspaceHistoryEntry): string {
  // A version number is the whole identity a reader needs. The tag and the
  // commit underneath it are how Bindersnap stores that version, not what the
  // version is — and nobody reading this record can look either one up, so
  // printing them only invites a question the file cannot answer.
  const facts: [string, string][] = [
    ["Published", formatTimestamp(entry.publishedAt) || "Unknown"],
  ];

  if (entry.changeNumber !== null) {
    facts.push(
      ["Change", `#${entry.changeNumber}`],
      ["Submitted by", personLabel(entry.submittedBy)],
    );
  } else {
    // A version with no surviving change record is still on the record. Saying
    // so is the honest answer; leaving the rows out looks like an omission.
    facts.push(["Change", "No change record survives for this version"]);
  }

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
    `<h2>${escapeHtml(entry.changeTitle || `Version ${entry.version}`)}</h2>`,
    "</header>",
    `<dl class="record-facts">${factRows}</dl>`,
    '<table class="record-reviews">',
    '<colgroup><col class="record-col-who" /><col /></colgroup>',
    "<thead><tr><th>Approved by</th><th></th></tr></thead>",
    `<tbody>${renderApproverRows(entry.approvers)}</tbody>`,
    "</table>",
    "</section>",
  ].join("");
}

/**
 * Who signed this version off.
 *
 * **Only approvals that stood at the moment it was published.** A stale or
 * dismissed review is not a sign-off, and a record that listed one would be
 * claiming somebody approved a version they did not see. The server already
 * applies that rule when it builds the history; this only prints it.
 */
function renderApproverRows(approvers: string[]): string {
  if (approvers.length === 0) {
    return '<tr><td colspan="2">No approval was recorded against this version.</td></tr>';
  }

  return approvers
    .map(
      (login) => `<tr><td>${escapeHtml(personLabel(login))}</td><td></td></tr>`,
    )
    .join("");
}

/**
 * The exported record.
 *
 * Styles are inlined and the values mirror `bindersnap-tokens.css` by name —
 * the file has to open with no network and no stylesheet next to it, so the
 * tokens come along as custom properties rather than as an import.
 */
export function buildAuditRecord(input: AuditRecordInput): AuditRecord {
  const { organization, binder, versions, generatedAt } = input;
  const documentName = binder;

  // Grouped by document, newest version first inside each. A regulator reads
  // this one policy at a time — "show me infection control" — not as one
  // chronological stream across the manual.
  const byDocument = new Map<string, WorkspaceHistoryEntry[]>();
  for (const entry of versions) {
    const existing = byDocument.get(entry.slugPath);
    if (existing) existing.push(entry);
    else byDocument.set(entry.slugPath, [entry]);
  }

  const documents = [...byDocument.entries()]
    .map(([slugPath, entries]) => ({
      slugPath,
      name: entries[0]?.name ?? slugPath,
      entries: [...entries].sort((a, b) => b.version - a.version),
    }))
    .sort((left, right) => left.slugPath.localeCompare(right.slugPath));

  const summary: [string, string][] = [
    ["Organization", organization],
    ["Binder", binder],
    [
      "Policies on record",
      documents.length === 1 ? "1 policy" : `${documents.length} policies`,
    ],
    ["Published versions", String(versions.length)],
    ["Exported", formatTimestamp(generatedAt.toISOString()) || "Unknown"],
  ];

  const summaryRows = summary
    .map(
      ([label, value]) =>
        `<div class="record-fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");

  const body =
    documents.length === 0
      ? '<p class="record-empty-state">This binder has no published versions yet, so there is nothing on the record.</p>'
      : documents
          .map((document) =>
            [
              '<section class="record-document">',
              `<h2 class="record-document-name">${escapeHtml(document.name)}</h2>`,
              `<p class="record-document-path">${escapeHtml(document.slugPath)}</p>`,
              document.entries.map(renderVersion).join(""),
              "</section>",
            ].join(""),
          )
          .join("");

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
<footer>Exported from Bindersnap. This record is generated from the binder's version history; it is not editable and re-exporting reproduces it.</footer>
</main>
</body>
</html>
`;

  return { fileName: buildAuditRecordFileName(binder, generatedAt), html };
}
