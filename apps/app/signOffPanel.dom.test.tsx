import { afterAll, beforeAll, expect, test } from "bun:test";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { SignOffPanel } from "./components/SignOffPanel";
import { PersonAvatar } from "./components/PersonAvatar";
import type { SignOffPanelView } from "./signOffPanel";

const saved: Record<string, unknown> = {};
beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://app.bindersnap.com/",
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    KeyboardEvent: dom.window.KeyboardEvent,
    FocusEvent: dom.window.FocusEvent,
    Event: dom.window.Event,
  })) {
    saved[key] = (globalThis as Record<string, unknown>)[key];
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(node));
  return {
    container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

const view: SignOffPanelView = {
  lead: "Publishing a new version needs one approval from each of these.",
  here: [],
  hereEmpty: "Nothing is set on this document alone.",
  above: [
    {
      key: "folder:clinical:team:infection-control",
      kind: "group",
      group: "infection-control",
      title: "Infection Control",
      detail: "A folder above",
      origin: {
        label: "Clinical Standards",
        to: { kind: "folder", path: "clinical" },
      },
      people: [{ login: "grace", fullName: "Grace Ibori", hasAccess: true }],
      hasAccess: false,
      rule: {
        scope: "folder",
        target: "clinical",
        teams: ["infection-control"],
        users: [],
      },
    },
  ],
  foot: null,
  ownRule: null,
  ownTarget: null,
};

test("the panel says what is set here, what is from above, and where", () => {
  const opened: unknown[] = [];
  const { container, unmount } = mount(
    <SignOffPanel
      org="riverside-health"
      view={view}
      onNavigate={() => {}}
      onOpenOrigin={(origin) => opened.push(origin)}
      originHref={() => "/riverside-health/governance/-/tree/main/clinical"}
    />,
  );
  const text = container.textContent ?? "";
  expect(text).toContain("Set here");
  expect(text).toContain("Nothing is set on this document alone.");
  expect(text).toContain("From above");
  expect(text).toContain("No access to this binder");
  const group = container.querySelector<HTMLAnchorElement>("a.group-link");
  expect(group?.getAttribute("href")).toBe(
    "/riverside-health/-/groups/infection-control",
  );
  const origin = container.querySelector<HTMLAnchorElement>("a.signoff-origin");
  origin?.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, button: 0 }),
  );
  expect(opened).toEqual([{ kind: "folder", path: "clinical" }]);
  // No edit controls outside the editor.
  expect(container.querySelector(".signoff-remove")).toBeNull();
  unmount();
});

test("a face's card opens on focus and closes on Escape", () => {
  const { container, unmount } = mount(
    <PersonAvatar
      person={{ login: "grace", fullName: "Grace Ibori" }}
      card="Infection Control · signs off on this folder"
    />,
  );
  const face = container.querySelector<HTMLElement>(".person-card-anchor")!;
  expect(face.getAttribute("tabindex")).toBe("0");
  expect(face.getAttribute("aria-label")).toBe("Grace Ibori");
  flushSync(() => face.focus());
  flushSync(() => {
    face.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
  });
  const card = container.querySelector(".person-card");
  expect(card?.textContent).toContain("@grace");
  expect(card?.textContent).toContain("signs off on this folder");
  expect(face.getAttribute("aria-describedby")).toBe(card?.id ?? "");
  flushSync(() => {
    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape" }),
    );
  });
  expect(container.querySelector(".person-card")).toBeNull();
  unmount();
});
