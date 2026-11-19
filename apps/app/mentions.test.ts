import { describe, expect, test } from "bun:test";
import { findMentionQuery, insertMention, splitMentions } from "./mentions";

describe("findMentionQuery", () => {
  test("a bare @ at the start opens an empty query", () => {
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  test("what is typed after the @ is the query", () => {
    const text = "Thanks @pri";
    expect(findMentionQuery(text, text.length)).toEqual({
      start: 7,
      end: 11,
      query: "pri",
    });
  });

  test("the caret in the middle of a word queries up to the caret", () => {
    expect(findMentionQuery("@priya ok", 4)).toEqual({
      start: 0,
      end: 4,
      query: "pri",
    });
  });

  test("after opening punctuation", () => {
    expect(findMentionQuery("(@sam", 5)?.query).toBe("sam");
  });

  test("an email address is not a mention", () => {
    const text = "write to sam@example";
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  test("a space after the name closes it", () => {
    const text = "@sam ";
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  test("no @ at all", () => {
    expect(findMentionQuery("hello", 5)).toBeNull();
  });

  test("a login cannot start with punctuation", () => {
    expect(findMentionQuery("@.x", 3)).toBeNull();
  });

  test("dots, dashes and underscores belong to the login", () => {
    expect(findMentionQuery("@a.b-c_d", 8)?.query).toBe("a.b-c_d");
  });
});

describe("insertMention", () => {
  test("replaces the query and adds a space", () => {
    const text = "Thanks @pri";
    const query = findMentionQuery(text, text.length)!;
    expect(insertMention(text, query, "priya")).toEqual({
      text: "Thanks @priya ",
      caret: 14,
    });
  });

  test("replaces the rest of the word after the caret", () => {
    const query = findMentionQuery("@prxx ok", 3)!;
    expect(insertMention("@prxx ok", query, "priya")).toEqual({
      text: "@priya ok",
      caret: 6,
    });
  });

  test("no extra space before punctuation", () => {
    const query = findMentionQuery("@sa, hi", 3)!;
    expect(insertMention("@sa, hi", query, "sam").text).toBe("@sam, hi");
  });
});

describe("splitMentions", () => {
  test("text without mentions is one run", () => {
    expect(splitMentions("hello")).toEqual([{ kind: "text", text: "hello" }]);
  });

  test("picks out mentions and keeps the rest", () => {
    expect(splitMentions("Ask @priya and @sam.")).toEqual([
      { kind: "text", text: "Ask " },
      { kind: "mention", login: "priya", text: "@priya" },
      { kind: "text", text: " and " },
      { kind: "mention", login: "sam", text: "@sam" },
      { kind: "text", text: "." },
    ]);
  });

  test("an email address stays text", () => {
    expect(splitMentions("sam@example.com")).toEqual([
      { kind: "text", text: "sam@example.com" },
    ]);
  });

  test("a lone @ stays text", () => {
    expect(splitMentions("at @ noon")).toEqual([
      { kind: "text", text: "at @ noon" },
    ]);
  });

  test("joining the parts gives back the text", () => {
    const text = "(@a.b) @x-y, mail@z.org @ @.no";
    expect(
      splitMentions(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });
});
