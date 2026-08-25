import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";

import * as api from "../api";
import type { AppRoute } from "../routes";

/**
 * Quick find, rendered.
 *
 * What has to survive a redesign: typing produces a list of documents without
 * a submit, picking one opens that document, scrolling to the bottom of the
 * list fetches the next page, and Enter with nothing picked still falls back
 * to searching the library.
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
    id: number;
    name: string;
    full_name: string;
    description: string;
    updated_at: string;
    owner: { login: string };
  }[];
  page: number;
  limit: number;
  hasMore: boolean;
};

let pages: SearchResponse[] = [];
let searchCalls: { query: string; page: number }[] = [];
let searchFails = false;

const mockSearchDocuments = mock(async (query: string, page = 1) => {
  searchCalls.push({ query, page });
  if (searchFails) throw new Error("search is down");
  return pages[page - 1] ?? { documents: [], page, limit: 8, hasMore: false };
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
  pages = [];
  searchCalls = [];
  searchFails = false;
  document.body.innerHTML = "";
});

afterEach(async () => {
  // React's scheduler reads the document from a callback of its own; let any
  // work it has queued finish before the next test empties the body.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

function page(
  names: string[],
  pageNumber: number,
  hasMore: boolean,
): SearchResponse {
  return {
    documents: names.map((name, index) => ({
      id: pageNumber * 100 + index,
      name,
      full_name: `alice/${name}`,
      description: "",
      updated_at: "2026-08-25T10:00:00Z",
      owner: { login: "alice" },
    })),
    page: pageNumber,
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

/** Type into the box, then let the debounce and the fetch both land. */
async function type(container: HTMLElement, value: string) {
  const input = container.querySelector("input") as HTMLInputElement;

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

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[role="option"]'));
}

test("typing lists matching documents without a submit", async () => {
  pages = [page(["vendor-agreement", "nda"], 1, false)];
  const view = await render(createElement(NavSearch, props()));

  await type(view.container, "ven");

  expect(rows(view.container)).toHaveLength(2);
  expect(view.container.textContent).toContain("Vendor Agreement");
  expect(view.container.textContent).toContain("Alice owns");
  expect(searchCalls).toEqual([{ query: "ven", page: 1 }]);

  await view.unmount();
});

test("a query too short to be a question is not asked", async () => {
  const view = await render(createElement(NavSearch, props()));

  await type(view.container, "v");

  expect(searchCalls).toEqual([]);
  expect(view.container.querySelector(".app-nav-search-panel")).toBeNull();

  await view.unmount();
});

test("arrow down then Enter opens the highlighted document", async () => {
  pages = [page(["vendor-agreement", "nda"], 1, false)];
  const opened: AppRoute[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onNavigate: (route: AppRoute) => opened.push(route) }),
    ),
  );

  const input = await type(view.container, "ven");
  await press(input, "ArrowDown");
  await press(input, "ArrowDown");
  await submit(input);

  expect(opened).toEqual([
    { kind: "document", owner: "alice", repo: "nda", tab: "overview" },
  ]);

  await view.unmount();
});

test("arrow up from nothing highlighted reaches the last result", async () => {
  pages = [page(["vendor-agreement", "nda"], 1, false)];
  const opened: AppRoute[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onNavigate: (route: AppRoute) => opened.push(route) }),
    ),
  );

  const input = await type(view.container, "ven");
  await press(input, "ArrowUp");
  await submit(input);

  expect(opened[0]).toMatchObject({ repo: "nda" });

  await view.unmount();
});

test("Enter with nothing highlighted searches the library", async () => {
  pages = [page(["vendor-agreement"], 1, false)];
  const searched: string[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onSearchLibrary: (query: string) => searched.push(query) }),
    ),
  );

  const input = await type(view.container, "ven");
  await submit(input);

  expect(searched).toEqual(["ven"]);

  await view.unmount();
});

test("clicking a result opens it", async () => {
  pages = [page(["vendor-agreement"], 1, false)];
  const opened: AppRoute[] = [];
  const view = await render(
    createElement(
      NavSearch,
      props({ onNavigate: (route: AppRoute) => opened.push(route) }),
    ),
  );

  await type(view.container, "ven");
  await act(async () => {
    rows(view.container)[0]?.dispatchEvent(
      new dom.window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(opened).toEqual([
    {
      kind: "document",
      owner: "alice",
      repo: "vendor-agreement",
      tab: "overview",
    },
  ]);

  await view.unmount();
});

test("scrolling to the bottom of the list loads the next page", async () => {
  pages = [page(["a-one", "a-two"], 1, true), page(["a-three"], 2, false)];
  const view = await render(createElement(NavSearch, props()));

  await type(view.container, "agreement");
  expect(rows(view.container)).toHaveLength(2);

  const list = view.container.querySelector(
    ".app-nav-search-results",
  ) as HTMLElement;
  await act(async () => {
    list.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(searchCalls).toEqual([
    { query: "agreement", page: 1 },
    { query: "agreement", page: 2 },
  ]);
  expect(rows(view.container)).toHaveLength(3);

  await view.unmount();
});

test("a last page is not asked for twice", async () => {
  pages = [page(["a-one"], 1, false)];
  const view = await render(createElement(NavSearch, props()));

  await type(view.container, "agreement");
  const list = view.container.querySelector(
    ".app-nav-search-results",
  ) as HTMLElement;
  await act(async () => {
    list.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
    list.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
  });

  expect(searchCalls).toHaveLength(1);

  await view.unmount();
});

test("nothing matching says so", async () => {
  pages = [page([], 1, false)];
  const view = await render(createElement(NavSearch, props()));

  await type(view.container, "zzz");

  expect(view.container.textContent).toContain("No documents match “zzz”");

  await view.unmount();
});

test("a failed search says so instead of showing an empty library", async () => {
  searchFails = true;
  const view = await render(createElement(NavSearch, props()));

  await type(view.container, "ven");

  expect(view.container.textContent).toContain("Search is unavailable");

  await view.unmount();
});
