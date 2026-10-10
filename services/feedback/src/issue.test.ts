import { describe, expect, test } from "bun:test";

import { cell, code, feedbackIssue, fenced, plain } from "./issue";
import { testReport } from "./testReport";

describe("a feedback report as an issue", () => {
  test("the person's words come first, then who, where and what failed", () => {
    const issue = feedbackIssue(testReport());

    expect(issue.title).toBe("Publishing does nothing");
    expect(issue.labels).toEqual(["from-app", "bug"]);
    expect(issue.body.startsWith("I pressed Publish")).toBe(true);
    expect(issue.body).toContain(
      "| From | `alice` (Alice Doe, alice@example.com) — self-reported |",
    );
    expect(issue.body).toContain("| Organization | `acme` (Acme Health) |");
    expect(issue.body).toContain(
      "POST `/api/app/documents/acme/policies/pull-requests/12/publish` → 500 `0b8c1d5e-0000-4000-8000-000000000002`",
    );
    expect(issue.body).toContain("| Route: change | `12` |");
    expect(issue.body).toContain("<summary>API calls (2)</summary>");
    expect(issue.body).toContain("<summary>Console errors (1)</summary>");
    expect(issue.body).toContain("<summary>Full trace (JSON)</summary>");
    expect(issue.body).not.toContain("Failing queries");
  });

  test("an idea is labelled as one, and a signed-out report says so", () => {
    const report = testReport({ kind: "idea" });
    report.trace.user = null;
    report.trace.organization = null;
    const issue = feedbackIssue(report);

    expect(issue.labels).toEqual(["from-app", "idea"]);
    expect(issue.body).toContain("| From | signed out |");
    expect(issue.body).toContain("| Organization | none |");
  });

  test("a username is never written as a GitHub mention", () => {
    const issue = feedbackIssue(testReport());
    expect(issue.body).not.toContain("@alice");
  });

  test("a newline in the title does not survive", () => {
    const issue = feedbackIssue(testReport({ title: "Two\nlines" }));
    expect(issue.title).toBe("Two lines");
  });
});

describe("text from a browser stays text", () => {
  test("a pipe or newline cannot break a table row", () => {
    expect(cell("a | b\nc")).toBe("a \\| b c");
  });

  test("tags and emphasis are shown, not rendered", () => {
    expect(plain("<img src=x> *bold* [link]")).not.toMatch(/[<>*[\]]/);
  });

  test("inline code cannot be closed from inside", () => {
    expect(code("a`b")).toBe("``a`b``");
    expect(code("`edge")).toBe("`` `edge ``");
  });

  test("a fence is longer than any run of backticks inside it", () => {
    const block = fenced("```\nnot the end\n````");
    expect(block.startsWith("`````text\n")).toBe(true);
    expect(block.endsWith("\n`````")).toBe(true);
  });
});
