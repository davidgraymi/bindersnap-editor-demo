import { expect, test } from "bun:test";

import { resolveAuthIntent } from "./authIntent";
import { resolveGiteaTokenScopes } from "./giteaTokenScopes";

test("resolveGiteaTokenScopes includes all required write scopes by default", () => {
  expect(resolveGiteaTokenScopes()).toEqual([
    "write:user",
    "write:repository",
    "write:issue",
  ]);
});

test("resolveGiteaTokenScopes preserves configured scopes and adds missing required scopes", () => {
  const scopes = resolveGiteaTokenScopes("read:user,write:repository");

  expect(scopes).toContain("read:user");
  expect(scopes).toContain("write:user");
  expect(scopes).toContain("write:repository");
  expect(scopes).toContain("write:issue");
});

test("resolveGiteaTokenScopes de-duplicates repeated scopes", () => {
  const scopes = resolveGiteaTokenScopes(
    "write:issue,write:user,write:repository,write:issue",
  );

  expect(scopes.filter((scope) => scope === "write:issue")).toHaveLength(1);
  expect(scopes.filter((scope) => scope === "write:user")).toHaveLength(1);
  expect(scopes.filter((scope) => scope === "write:repository")).toHaveLength(
    1,
  );
});

test("resolveAuthIntent defaults the login screen to sign in", () => {
  expect(resolveAuthIntent("")).toEqual({
    mode: "signin",
    email: "",
  });
});

test("resolveAuthIntent opens signup mode and prefills the landing email", () => {
  expect(resolveAuthIntent("?mode=signup&email=team%40bindersnap.com")).toEqual(
    {
      mode: "signup",
      email: "team@bindersnap.com",
    },
  );
});
