import { expect, test } from "bun:test";

import { stripTags } from "./stripTags";

test("a heading's markup comes off and its text stays", () => {
  expect(stripTags("Keep it <em>with the policy.</em>")).toBe(
    "Keep it with the policy.",
  );
  expect(stripTags('<a href="#x">Section</a> 7')).toBe("Section 7");
});

test("no tag survives, however it is nested or left open", () => {
  expect(stripTags("<<b>script>alert(1)")).toBe("scriptalert(1)");
  expect(stripTags("a <script")).toBe("a ");
  expect(stripTags("a > b")).toBe("a  b");
  for (const input of ["<<script>>", "<scr<b>ipt>", "x<"]) {
    expect(stripTags(input)).not.toMatch(/[<>]/);
  }
});

test("entities are left for the page to read", () => {
  expect(stripTags("Q&amp;A <b>&lt;draft&gt;</b>")).toBe(
    "Q&amp;A &lt;draft&gt;",
  );
});
