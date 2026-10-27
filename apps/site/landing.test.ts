import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bindSignupEnterKeys,
  buildSignupUrl,
  installScrollReveal,
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

  // The address typed, then where the visit came from (`signupSource.ts`).
  expect(targetUrl).toBe(
    "https://app.bindersnap.com/-/signup?email=team%40bindersnap.com&from=%2F",
  );
  expect(navigations).toEqual([targetUrl]);
});

test("a landing signup is counted by where it was, never by the address typed", () => {
  installDom();
  const sent: unknown[][] = [];
  const global = globalThis as { gtag?: (...args: unknown[]) => void };
  global.gtag = (...args) => sent.push(args);
  try {
    routeLandingSignup(document, "hero", () => {});
    routeLandingSignup(document, "cta", () => {});
  } finally {
    delete global.gtag;
  }
  expect(sent).toEqual([
    ["event", "cta_click", { cta: "landing_hero", with_email: "yes" }],
    ["event", "cta_click", { cta: "landing_closing", with_email: "no" }],
  ]);
  expect(JSON.stringify(sent)).not.toContain("team@bindersnap.com");
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

test("the landing page promises the trial the way every other page does", () => {
  // Cold traffic lands here. A cautious buyer reads "Cancel anytime" as a
  // subscription about to start, so both forms make the inner pages' offer,
  // word for word.
  const html = readFileSync(join(import.meta.dir, "index.html"), "utf8");
  const buttons = [
    ...html.matchAll(/id="(?:hero|cta)-signup-btn">\s*([^<]+?)\s*</g),
  ].map((match) => match[1]);

  expect(buttons).toEqual([
    "Start your 14-day free trial &rarr;",
    "Start your 14-day free trial",
  ]);
  expect(
    html.match(/No card required &middot; Reviewers and readers are free/g),
  ).toHaveLength(2);
  expect(html).not.toContain("Cancel anytime");
});

test("the landing page names every kind of provider it is for", () => {
  // A hospice administrator who does not see hers in the first line wonders
  // whether this is for her. The /for pages cover all six.
  const html = readFileSync(join(import.meta.dir, "index.html"), "utf8");
  const hero = html.match(/<p class="hero-sub">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const words = hero.replace(/\s+/g, " ");

  for (const kind of [
    "clinics",
    "surgery centers",
    "home health agencies",
    "hospices",
    "behavioral health programs",
    "rural health clinics",
  ]) {
    expect(words).toContain(kind);
  }
});

test("a section skipped over by a jump is shown at once, without a fade", async () => {
  // An observer that never fires: a jump past a section never makes it
  // intersect, so the observer alone would leave it blank.
  const dom = new JSDOM(
    `<div class="reveal" id="above"></div><div class="reveal" id="below"></div>`,
    { url: "https://bindersnap.com/#signup", pretendToBeVisual: true },
  );
  const win = dom.window as unknown as Window & typeof globalThis;
  (win as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const above = win.document.getElementById("above")!;
  const below = win.document.getElementById("below")!;
  above.getBoundingClientRect = () => ({ top: -900, bottom: -400 }) as DOMRect;
  below.getBoundingClientRect = () => ({ top: 2000, bottom: 2400 }) as DOMRect;

  const previous = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = win.IntersectionObserver;
  try {
    installScrollReveal(win.document);
    await new Promise((resolve) => win.requestAnimationFrame(resolve));

    expect(above.className).toBe("reveal reveal-instant in");
    expect(below.classList.contains("in")).toBe(false);
  } finally {
    globalThis.IntersectionObserver = previous;
    dom.window.close();
  }
});
