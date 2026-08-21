import { expect, test } from "bun:test";

import { markdownToHtml } from "./markdown";

test("renders headings, paragraphs and emphasis", () => {
  const html = markdownToHtml(
    "# Policy\n\nThe **retention** window is _seven_ years.",
  );

  expect(html).toContain("<h1>Policy</h1>");
  expect(html).toContain("<strong>retention</strong>");
  expect(html).toContain("<em>seven</em>");
});

test("joins wrapped paragraph lines and splits on blank lines", () => {
  const html = markdownToHtml("one\ntwo\n\nthree");
  expect(html).toContain("<p>one two</p>");
  expect(html).toContain("<p>three</p>");
});

test("renders bullet and numbered lists", () => {
  expect(markdownToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
  expect(markdownToHtml("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
});

test("renders tables with a header row", () => {
  const html = markdownToHtml("| Name | Role |\n| --- | --- |\n| Ada | Lead |");

  expect(html).toContain("<th>Name</th>");
  expect(html).toContain("<td>Ada</td>");
});

test("renders fenced code blocks verbatim", () => {
  const html = markdownToHtml("```\nconst a = 1 < 2;\n```");
  expect(html).toBe("<pre><code>const a = 1 &lt; 2;</code></pre>");
});

test("keeps inline code out of the emphasis pass", () => {
  const html = markdownToHtml("Use `a_b_c` here.");
  expect(html).toBe("<p>Use <code>a_b_c</code> here.</p>");
});

test("escapes embedded HTML rather than rendering it", () => {
  const html = markdownToHtml("<img src=x onerror=alert(1)>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
});

test("drops links with an unsafe scheme but keeps the text", () => {
  const html = markdownToHtml("[click](javascript:alert(1))");
  expect(html).not.toContain("<a ");
  expect(html).toContain("click");
});

test("keeps http, mailto and relative links", () => {
  expect(markdownToHtml("[a](https://example.com)")).toContain(
    '<a href="https://example.com" rel="noopener noreferrer">a</a>',
  );
  expect(markdownToHtml("[b](mailto:me@example.com)")).toContain("<a href=");
  expect(markdownToHtml("[c](/docs/policy)")).toContain("<a href=");
});

test("renders blockquotes and horizontal rules", () => {
  expect(markdownToHtml("> quoted\n> lines")).toBe(
    "<blockquote><p>quoted lines</p></blockquote>",
  );
  expect(markdownToHtml("---")).toBe("<hr />");
});

test("returns an empty string for empty input", () => {
  expect(markdownToHtml("")).toBe("");
  expect(markdownToHtml("\n\n  \n")).toBe("");
});
