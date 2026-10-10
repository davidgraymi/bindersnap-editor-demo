/**
 * A feedback report, written as a GitHub issue.
 *
 * The person's own words come first, then a table a triager reads in five
 * seconds, then everything else folded away. Every value in it came from a
 * browser, so none of it is trusted as Markdown: table cells are escaped, and
 * code blocks are fenced with more backticks than the text contains.
 */

import type {
  FeedbackKind,
  FeedbackReport,
  FeedbackTrace,
} from "../../../packages/utils/feedbackReport";

export interface FeedbackIssue {
  title: string;
  body: string;
  labels: string[];
}

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "bug",
  idea: "idea",
  other: "feedback",
};

export function feedbackIssue(report: FeedbackReport): FeedbackIssue {
  const { trace } = report;
  return {
    title: report.title.replace(/\s+/g, " ").trim(),
    labels: ["from-app", KIND_LABEL[report.kind]],
    body: [
      report.description,
      "",
      "---",
      "",
      summaryTable(report.kind, trace),
      "",
      apiCallsSection(trace),
      errorsSection(trace),
      navigationSection(trace),
      queriesSection(trace),
      details(
        "Full trace (JSON)",
        fenced(JSON.stringify(trace, null, 2), "json"),
      ),
    ]
      .filter((part) => part !== null)
      .join("\n"),
  };
}

function summaryTable(kind: FeedbackKind, trace: FeedbackTrace): string {
  const failed = trace.apiCalls.filter(
    (call) => call.status === 0 || call.status >= 400,
  );
  const rows: [string, string][] = [
    ["Kind", kind],
    ["From", who(trace)],
    ["Organization", organization(trace)],
    ["Page", code(trace.url)],
    ["App", `${trace.app.version} (${code(trace.app.commit)})`],
    ["Browser", plain(trace.environment.userAgent)],
    [
      "Screen",
      `${plain(trace.environment.viewport)} @${trace.environment.devicePixelRatio}x, ${plain(trace.environment.language)}, ${plain(trace.environment.timeZone)}${trace.environment.online ? "" : ", **offline**"}`,
    ],
    ["Open for", duration(trace.environment.sinceLoadMs)],
    ["Captured", trace.capturedAt],
  ];
  if (failed.length > 0) {
    rows.push([
      "Failed requests",
      failed
        .map(
          (call) =>
            `${plain(call.method)} ${code(call.path)} → ${call.status || "no answer"}${call.requestId ? ` ${code(call.requestId)}` : ""}`,
        )
        .join("<br>"),
    ]);
  }
  for (const [key, value] of Object.entries(trace.route)) {
    rows.push([`Route: ${plain(key)}`, code(String(value))]);
  }
  for (const [key, value] of Object.entries(trace.state)) {
    rows.push([`State: ${plain(key)}`, code(String(value))]);
  }
  return [
    "| | |",
    "| --- | --- |",
    ...rows.map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`),
  ].join("\n");
}

function who(trace: FeedbackTrace): string {
  if (!trace.user) return "signed out";
  const { username, name, email } = trace.user;
  const extra = plain([name, email].filter(Boolean).join(", "));
  // Not `@username`: a Bindersnap username is not a GitHub account, and a
  // mention would notify whoever owns that name on GitHub.
  return `${code(username)}${extra ? ` (${extra})` : ""} — self-reported`;
}

function organization(trace: FeedbackTrace): string {
  if (!trace.organization) return "none";
  const { name, displayName } = trace.organization;
  return `${code(name)}${displayName ? ` (${plain(displayName)})` : ""}`;
}

function apiCallsSection(trace: FeedbackTrace): string | null {
  if (trace.apiCalls.length === 0) return null;
  const rows = trace.apiCalls.map(
    (call) =>
      `| ${cell(plain(call.at))} | ${cell(plain(call.method))} | ${cell(code(call.path))} | ${call.status || "—"} | ${Math.round(call.durationMs)} ms | ${call.requestId ? cell(code(call.requestId)) : ""} |`,
  );
  return details(
    `API calls (${trace.apiCalls.length})`,
    [
      "| At | Method | Path | Status | Took | Request ID |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
  );
}

function errorsSection(trace: FeedbackTrace): string | null {
  if (trace.errors.length === 0) return null;
  const text = trace.errors
    .map(
      (error) =>
        `[${error.at}] ${error.source}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`,
    )
    .join("\n\n");
  return details(`Console errors (${trace.errors.length})`, fenced(text));
}

function navigationSection(trace: FeedbackTrace): string | null {
  if (trace.navigation.length === 0) return null;
  const text = trace.navigation
    .map((step) => `${step.at}  ${step.path}`)
    .join("\n");
  return details(`Navigation (${trace.navigation.length})`, fenced(text));
}

function queriesSection(trace: FeedbackTrace): string | null {
  if (trace.failingQueries.length === 0) return null;
  const text = trace.failingQueries
    .map((query) => `${query.key}\n  ${query.error}`)
    .join("\n");
  return details(
    `Failing queries (${trace.failingQueries.length})`,
    fenced(text),
  );
}

function details(summary: string, content: string): string {
  return `<details><summary>${plain(summary)}</summary>\n\n${content}\n\n</details>\n`;
}

/** A fenced block no line of `text` can close early. */
export function fenced(text: string, language = "text"): string {
  const longest = Math.max(
    2,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

/** Inline code that `value` cannot break out of. */
export function code(value: string): string {
  const longest = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const ticks = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${ticks}${pad}${value}${pad}${ticks}`;
}

/**
 * One line of a table cell: no pipe ends it early, no newline breaks the row.
 * GitHub unescapes `\|` before it reads code spans, so this is safe on them.
 */
export function cell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

/** Text from the browser, shown as text: no tags, no Markdown emphasis. */
export function plain(value: string): string {
  return value.replace(/[<>&*_[\]`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)} s`;
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}
