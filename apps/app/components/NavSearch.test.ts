import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";

import * as api from "../api";
import type { AppRoute } from "../routes";

/**
 * Quick find, rendered.
 *
 * What has to survive a redesign: the nav opens an overlay rather than
 * searching in place, typing produces a list of documents without a submit,
 * picking one opens that document, scrolling to the bottom of the list
 * fetches the next page, and Enter with nothing picked still falls back to
 * searching the library.
 */

/**
 * The DOM goes in before React does.
 *
 * React decides once, at import, whether the browser it is in fires `input`
 * events — and answers "no" for a page that has no `document` yet, which
 * leaves it listening for a change event this century does not have. So the
 * window is installed first and every React import below is dynamic.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://bindersnap.com/documents",
});

for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "Event",
  "KeyboardEvent",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}

// JSDOM has no layout, so a highlighted row cannot scroll itself into view.
dom.window.Element.prototype.scrollIntoView = () => {};

/**
 * React may still have decided, in a sibling test file that imported it before
 * any window existed, that this browser predates the `input` event — in which
 * case it watches the focused field the old way instead. These two no-ops are
 * what that path expects to find on an element; without them it throws, and a
 * typed character never reaches the component.
 */
const inputPrototype = dom.window.HTMLInputElement.prototype as unknown as {
  attachEvent: () => void;
  detachEvent: () => void;
};
inputPrototype.attachEvent = () => {};
inputPrototype.detachEvent = () => {};
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type SearchResponse = {
  documents: {
    path: string | null;
    slugPath: string;
    name: string;
    folder: string;
    size: number | null;
    sha: string | null;
    state: "published" | "proposed";
    openChangeCount: number;
    latestVersion: null;
    organization: string;
    binder: string;
    binderDescription: string;
  }[];
  limit: number;
  hasMore: boolean;
};

let response: SearchResponse | null = null;
let searchCalls: { query: string; limit: number }[] = [];
let searchFails = false;

const mockSearchDocuments = mock(async (query: string, limit = 8) => {
  searchCalls.push({ query, limit });
  if (searchFails) throw new Error("search is down");
  return response ?? { documents: [], limit, hasMore: false };
});

// Spread the real module: every test file in this directory mocks the same
// api client, and one that replaces it wholesale takes the others' calls away
// with it.
mock.module("../api", () => ({
  ...api,
  searchDocuments: mockSearchDocuments,
}));

// `require`, not a dynamic import: a top-level await hands control back to the
// runner, which lets a sibling test file's module mock land in the middle of
// this file's own setup.
const { act, createElement } = require("react") as typeof import("react");
const { createRoot } =
  require("react-dom/client") as typeof import("react-dom/client");
const { NavSearch } = require("./NavSearch") as typeof import("./NavSearch");

type ReactElement = ReturnType<typeof createElement>;

beforeEach(() => {
  response = null;
  searchCalls = [];
  searchFails = false;
  document.body.innerHTML = "";
});

afterEach(async () => {
  // React's scheduler reads the document from a callback of its own; let any
  // work it has queued finish before the next test empties the body.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

/** A search answer: policies in a binder, which is what a row now names. */
function found(names: string[], hasMore = false): SearchResponse {
  return {
    documents: names.map((name) => ({
      path: `nursing/${name}.docx`,
      slugPath: `nursing/${name}`,
      name,
      folder: "nursing",
      size: 10,
      sha: "abc",
      state: "published" as const,
      openChangeCount: 0,
      latestVersion: null,
      organization: "riverside-health",
      binder: "clinical",
      binderDescription: "",
    })),
    limit: 8,
    hasMore,
  };
}

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    currentUsername: "bob",
    initialQuery: "",
    onNavigate: (_route: AppRoute) => {},
    onSearchLibrary: (_query: string) => {},
    ...overrides,
  };
}

/** The overlay is a portal, so it lands on the body rather than in the tree. */
function overlay(): HTMLElement | null {
  return document.querySelector(".quick-find-dialog");
}

/** Press the nav button, the way a reader opens the search with a mouse. */
async function openOverlay(container: HTMLElement) {
  const trigger = container.querySelector(
    ".app-nav-search-trigger",
  ) as HTMLElement;
  await act(async () => {
    trigger.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  return overlay()!;
}

/** Type into the field, then let the debounce and the fetch both land. */
async function type(container: HTMLElement, value: string) {
  const input = (overlay() ?? container).querySelector(
    "input",
  ) as HTMLInputElement;

  await act(async () => {
    input.focus();
    // React tracks the last value it wrote, so the native setter is what makes
    // a programmatic edit look like a person typing.
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    // Both halves of the same keystroke: whichever of the two React is
    // listening for, one of them tells it the field changed.
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keyup", {
        key: value.slice(-1),
        bubbles: true,
      }),
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  return input;
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

async function submit(input: HTMLInputElement) {
  await act(async () => {
    input
      .closest("form")
      ?.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="option"]'));
}

test("the nav opens the search rather than holding it", async () => {
  const view = await render(createElement(NavSearch, props()));

  // Nothing to type into until the reader asks for it.
  expect(view.container.querySelector("input")).toBeNull();
  expect(overlay()).toBeNull();

  await openOverlay(view.container);

  expect(overlay()).not.toBeNull();
  expect(overlay()!.getAttribute("aria-modal")).toBe("true");
  // The field is the only thing anyone opens this to reach.
  expect(document.activeElement).toBe(overlay()!.querySelector("input"));

  await view.unmount();
});

test("`/` and ⌘K open the search from anywhere on the page", async () => {
  for (const event of [
    { key: "/" },
    { key: "k", metaKey: true },
    { key: "k", ctrlKey: true },
  ]) {
    const view = await render(createElement(NavSearch, props()));

    await act(async () => {
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { ...event, bubbles: true }),
      );
    });

    expect(overlay()).not.toBeNull();
    await view.unmount();
  }
});

test("Escape closes the search and puts focus back on the nav", async () => {
  const view = await render(createElement(NavSearch, props()));
  const input = (await openOverlay(view.container)).querySelector(
    "input",
  ) as HTMLInputElement;

  await press(input, "Escape");

  expect(overlay()).toBeNull();
  expect(document.activeElement).toBe(
    view.container.querySelector(".app-nav-search-trigger"),
  );

  await view.unmount();
});

test("clicking the dimmed page closes the search", async () => {
  const view = await render(createElement(NavSearch, props()));
  await openOverlay(view.container);

  const backdrop = document.querySelector(
    ".quick-find-backdrop",
  ) as HTMLElement;
  await act(async () => {
    backdrop.dispatchEvent(
      new dom.window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(overlay()).toBeNull();

  await view.unmount();
});

test("typing lists matching documents without a submit", async () => {
  response = found(["Vendor Agreement", "NDA"]);
  const view = await render(createElement(NavSearch, props()));
  await openOverlay(view.container);

  await type(view.container, "ven");

  expect(rows()).toHaveLength(2);
  expect(overlay()!.textContent).toContain("Vendor Agreement");
  expect(overlay()!.textContent).toContain("clinical · nursing");
  expect(searchCalls).toEqual([{ query: "ven", limit: 8 }]);

  await view.unmount();
});

test("a query too short to be a question is not asked", async () => {
  const view = await render(createElement(NavSearch, props()));
  await openOverlay(view.container);

  await type(view.container, "v");

  expect(searchCalls).toEqual([]);
  expect(rows()).toHaveLength(0);

  await view.unmount();
});

test("arrow down then Enter opens the highlighted document", async () => {
  response = found(["Vendor Agreement", "NDA"]);
  const opened: AppRoute[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onNavigate: (route: AppRoute) => opened.push(route) }),
    ),
  );
  await openOverlay(view.container);

  const input = await type(view.container, "ven");
  await press(input, "ArrowDown");
  await press(input, "ArrowDown");
  await submit(input);

  expect(opened).toEqual([
    {
      kind: "binderDocument",
      org: "riverside-health",
      binder: "clinical",
      documentPath: "nursing/NDA",
    },
  ]);
  // Opening a document closes the search behind it.
  expect(overlay()).toBeNull();

  await view.unmount();
});

test("arrow up from nothing highlighted reaches the last result", async () => {
  response = found(["Vendor Agreement", "NDA"]);
  const opened: AppRoute[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onNavigate: (route: AppRoute) => opened.push(route) }),
    ),
  );
  await openOverlay(view.container);

  const input = await type(view.container, "ven");
  await press(input, "ArrowUp");
  await submit(input);

  expect(opened[0]).toMatchObject({ documentPath: "nursing/NDA" });

  await view.unmount();
});

test("Enter with nothing highlighted searches the library", async () => {
  response = found(["Vendor Agreement"]);
  const searched: string[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onSearchLibrary: (query: string) => searched.push(query) }),
    ),
  );
  await openOverlay(view.container);

  const input = await type(view.container, "ven");
  await submit(input);

  expect(searched).toEqual(["ven"]);

  await view.unmount();
});

test("clicking a result opens it", async () => {
  response = found(["Vendor Agreement"]);
  const opened: AppRoute[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onNavigate: (route: AppRoute) => opened.push(route) }),
    ),
  );
  await openOverlay(view.container);

  await type(view.container, "ven");
  await act(async () => {
    rows()[0]?.dispatchEvent(
      new dom.window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(opened).toEqual([
    {
      kind: "binderDocument",
      org: "riverside-health",
      binder: "clinical",
      documentPath: "nursing/Vendor Agreement",
    },
  ]);

  await view.unmount();
});

test("nothing matching says so", async () => {
  response = found([]);
  const view = await render(createElement(NavSearch, props()));
  await openOverlay(view.container);

  await type(view.container, "zzz");

  expect(overlay()!.textContent).toContain("No documents match “zzz”");

  await view.unmount();
});

test("a failed search says so instead of showing an empty library", async () => {
  searchFails = true;
  const view = await render(createElement(NavSearch, props()));
  await openOverlay(view.container);

  await type(view.container, "ven");

  expect(overlay()!.textContent).toContain("Search is unavailable");

  await view.unmount();
});

test("a linked search is named on the nav button", async () => {
  const view = await render(
    createElement(NavSearch, props({ initialQuery: "vendor" })),
  );

  expect(
    view.container.querySelector(".app-nav-search-trigger")!.textContent,
  ).toContain("vendor");

  await view.unmount();
});
