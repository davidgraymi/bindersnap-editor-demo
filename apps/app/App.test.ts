import { expect, test } from "bun:test";

import { resolveSignupPrefill } from "./authIntent";
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

test("resolveSignupPrefill defaults to an empty email", () => {
  expect(resolveSignupPrefill("")).toEqual({
    email: "",
  });
});

test("resolveSignupPrefill reads the landing email from the query string", () => {
  expect(resolveSignupPrefill("?email=team%40bindersnap.com")).toEqual({
    email: "team@bindersnap.com",
  });
});
