/**
 * An error report, written as a GitHub issue the first time and as a comment
 * every time after.
 *
 * The title ends in the fingerprint, which is how the next occurrence finds
 * the issue again. Every value came from a browser or the API, so none of it
 * is trusted as Markdown; see `issue.ts` for the escaping.
 */

import type { ErrorReport } from "../../../packages/utils/errorReport";
import { cell, code, fenced, plain } from "./issue";

export interface ErrorIssue {
  title: string;
  body: string;
  labels: string[];
}

/** The labels every error issue carries. */
export function errorLabels(report: ErrorReport): string[] {
  return ["error", `from-${report.source}`];
}

export function errorIssue(
  report: ErrorReport,
  fingerprint: string,
): ErrorIssue {
  const headline = `${report.kind}: ${report.message}`
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: `${headline.slice(0, 160)} · ${fingerprint}`,
    labels: errorLabels(report),
    body: [
      fenced(report.message || "(no message)"),
      "",
      table([
        ["Source", report.source === "app" ? "The app" : "The API"],
        ["Kind", plain(report.kind)],
        ["Fingerprint", code(fingerprint)],
      ]),
      "",
      "### First seen",
      "",
      occurrenceTable(report),
      "",
      report.stack
        ? `<details open><summary>Stack</summary>\n\n${fenced(report.stack)}\n\n</details>\n`
        : null,
      "Every later occurrence adds a comment, at most one a minute. Close this " +
        "as **not planned** to stop hearing about it; close it as **completed** " +
        "and the next occurrence reopens it as a regression.",
    ]
      .filter((part) => part !== null)
      .join("\n"),
  };
}

/** One more occurrence of an error already on file. */
export function occurrenceComment(report: ErrorReport): string {
  return ["Seen again.", "", occurrenceTable(report)].join("\n");
}

function occurrenceTable(report: ErrorReport): string {
  const rows: [string, string][] = [
    ["At", plain(report.occurredAt)],
    ["Where", code(report.where)],
    ["App", `${plain(report.app.version)} (${code(report.app.commit)})`],
  ];
  if (report.requestIds.length > 0) {
    rows.push(["Request IDs", report.requestIds.map(code).join(" ")]);
  }
  if (report.browser) rows.push(["Browser", plain(report.browser)]);
  if (report.sinceLoadMs !== undefined) {
    rows.push(["Page open for", `${Math.round(report.sinceLoadMs / 1000)} s`]);
  }
  return table(rows);
}

function table(rows: [string, string][]): string {
  return [
    "| | |",
    "| --- | --- |",
    ...rows.map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`),
  ].join("\n");
}
