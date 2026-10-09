import { expect, test } from "bun:test";

import { avatarUrl } from "./avatar";

test("a face is asked for by login, at twice the size it is drawn", () => {
  expect(avatarUrl("jkim", 24)).toEndWith("/api/app/avatars/jkim?s=48");
  expect(avatarUrl("o'brien", 32)).toEndWith("/api/app/avatars/o'brien?s=64");
});
