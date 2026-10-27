import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import { rememberedSignupSource, rememberSignupSource } from "./signupSource";

let originalWindow: typeof globalThis.window | undefined;

beforeEach(() => {
  originalWindow = globalThis.window;
  const dom = new JSDOM("", { url: "https://app.bindersnap.com/-/signup" });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

test("the signup link's source is kept for the tab", () => {
  expect(rememberedSignupSource()).toBeNull();
  rememberSignupSource(
    "?email=jordan%40example.com&entry=/glossary/qapi&from=/pricing&ref=www.google.com",
  );
  expect(rememberedSignupSource()).toEqual({
    entryPath: "/glossary/qapi",
    fromPath: "/pricing",
    referrerHost: "www.google.com",
  });
});

test("an address with nothing to say keeps what was there", () => {
  rememberSignupSource("?entry=/templates");
  rememberSignupSource("?email=jordan%40example.com");
  expect(rememberedSignupSource()).toEqual({ entryPath: "/templates" });
});

test("a tampered value is dropped on the way out", () => {
  window.sessionStorage.setItem(
    "bindersnap.signupSource",
    JSON.stringify({ entryPath: "javascript:alert(1)", fromPath: "/pricing" }),
  );
  expect(rememberedSignupSource()).toEqual({ fromPath: "/pricing" });
  window.sessionStorage.setItem("bindersnap.signupSource", "{not json");
  expect(rememberedSignupSource()).toBeNull();
});
