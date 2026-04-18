import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import {
  bindSignupEnterKeys,
  buildSignupUrl,
  hideLandingContent,
  routeLandingSignup,
  shouldShowLanding,
  showLandingContent,
} from "./landing";

let originalWindow: typeof globalThis.window | undefined;
let originalDocument: typeof globalThis.document | undefined;

function installDom() {
  const dom = new JSDOM(
    `
      <div id="landing-content"></div>
      <input id="hero-email" value="team@bindersnap.com" />
      <input id="cta-email" value="" />
    `,
    { url: "https://bindersnap.com/" },
  );

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });

  return dom;
}

beforeEach(() => {
  originalWindow = globalThis.window;
  originalDocument = globalThis.document;
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

test("landing visibility helpers toggle the pre-rendered shell", () => {
  installDom();
  const landingContent = document.getElementById("landing-content");

  hideLandingContent(landingContent);
  expect(landingContent?.style.display).toBe("none");
  expect(landingContent?.getAttribute("aria-hidden")).toBe("true");

  showLandingContent(landingContent);
  expect(landingContent?.style.display).toBe("");
  expect(landingContent?.style.opacity).toBe("1");
  expect(landingContent?.hasAttribute("aria-hidden")).toBe(false);
});

test("buildSignupUrl opens signup mode and preserves a typed email", () => {
  expect(buildSignupUrl(" team@bindersnap.com ")).toBe(
    "/login?mode=signup&email=team%40bindersnap.com",
  );
  expect(buildSignupUrl("")).toBe("/login?mode=signup");
});

test("landing signup routes to the signup page with the typed email", () => {
  installDom();
  const navigations: string[] = [];

  const targetUrl = routeLandingSignup(document, "hero", (url) => {
    navigations.push(url);
  });

  expect(targetUrl).toBe("/login?mode=signup&email=team%40bindersnap.com");
  expect(navigations).toEqual([targetUrl]);
});

test("pressing Enter in a landing email field routes to signup", () => {
  installDom();
  const submittedSources: string[] = [];

  bindSignupEnterKeys(document, (source) => {
    submittedSources.push(source);
  });

  document
    .getElementById("cta-email")
    ?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

  expect(submittedSources).toEqual(["cta"]);
});

test("only the root pathname should show the landing shell", () => {
  expect(shouldShowLanding("/")).toBe(true);
  expect(shouldShowLanding("/login")).toBe(false);
  expect(shouldShowLanding("/docs/alice/quarterly-report")).toBe(false);
});
