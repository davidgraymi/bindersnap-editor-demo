import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bindSignupEnterKeys,
  buildSignupUrl,
  routeLandingSignup,
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

test("buildSignupUrl opens the app's signup and preserves a typed email", () => {
  expect(buildSignupUrl(" team@bindersnap.com ")).toBe(
    "https://app.bindersnap.com/-/signup?email=team%40bindersnap.com",
  );
  expect(buildSignupUrl("")).toBe("https://app.bindersnap.com/-/signup");
});

test("landing signup routes to the signup page with the typed email", () => {
  installDom();
  const navigations: string[] = [];

  const targetUrl = routeLandingSignup(document, "hero", (url) => {
    navigations.push(url);
  });

  expect(targetUrl).toBe(
    "https://app.bindersnap.com/-/signup?email=team%40bindersnap.com",
  );
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

test("the landing page draws without waiting for its script", () => {
  // Lighthouse, mobile: hiding the page until a React bundle had drawn its
  // icons kept a phone on a blank screen for seconds. The icons are SVG in
  // the markup, the stylesheets are ordinary ones, and nothing hides the page.
  const html = readFileSync(join(import.meta.dir, "index.html"), "utf8");
  const script = readFileSync(
    join(import.meta.dir, "landing-inline.ts"),
    "utf8",
  );

  expect(html).not.toContain("data-lucide-icon");
  expect(html).not.toMatch(/#landing-content\s*\{[^}]*opacity:\s*0/);
  expect(html).not.toMatch(/rel="preload"\s+as="style"/);
  expect(script).not.toMatch(/from "(react|react-dom|lucide-react)/);
});
