import { afterEach, beforeEach, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

import {
  DEFAULT_WAITLIST_COUNT,
  handleWaitlistSignup,
  hideLandingContent,
  shouldShowLanding,
  showLandingContent,
} from "./landing";

let originalWindow: typeof globalThis.window | undefined;
let originalDocument: typeof globalThis.document | undefined;

function installDom() {
  const dom = new JSDOM(
    `
      <div id="landing-content"></div>
      <span id="waitlist-count">${DEFAULT_WAITLIST_COUNT}</span>
      <span id="nav-count">${DEFAULT_WAITLIST_COUNT} on the waitlist</span>
      <div id="hero-form"></div>
      <div id="hero-success" style="display:none"></div>
      <div class="form-hint"></div>
      <input id="hero-email" value="team@bindersnap.com" />
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

test("waitlist signup updates the rendered counters", () => {
  installDom();

  const nextCount = handleWaitlistSignup(
    document,
    "hero",
    DEFAULT_WAITLIST_COUNT,
  );

  expect(nextCount).toBe(DEFAULT_WAITLIST_COUNT + 1);
  expect(document.getElementById("waitlist-count")?.textContent).toBe("248");
  expect(document.getElementById("nav-count")?.textContent).toBe(
    "248 on the waitlist",
  );
  expect(document.getElementById("hero-form")?.style.display).toBe("none");
  expect(document.getElementById("hero-success")?.style.display).toBe("flex");
});

test("only the root pathname should show the landing shell", () => {
  expect(shouldShowLanding("/")).toBe(true);
  expect(shouldShowLanding("/login")).toBe(false);
  expect(shouldShowLanding("/docs/alice/quarterly-report")).toBe(false);
});
