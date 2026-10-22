import { expect, test } from "bun:test";

import { contentsTarget, wireContentsLinks } from "./contentsLinks";

function sheet(html: string): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const POLICY = [
  '<div class="bs-toc"><p class="bs-toc-title">Contents</p>',
  '<p class="bs-toc-entry bs-toc-entry--1">Purpose</p>',
  '<p class="bs-toc-entry bs-toc-entry--2">Scope</p>',
  '<p class="bs-toc-entry bs-toc-entry--3">Wards</p></div>',
  "<h1>Purpose</h1><p>Why.</p><h2></h2><h2>Scope</h2><h4>Aside</h4><h3>Wards</h3>",
].join("");

test("each entry names the heading at its place, skipping empty ones", () => {
  const root = sheet(POLICY);
  const entries = [...root.querySelectorAll(".bs-toc-entry")];
  expect(entries.map((entry) => contentsTarget(entry)?.textContent)).toEqual([
    "Purpose",
    "Scope",
    "Wards",
  ]);
  root.remove();
});

test("entries become links a keyboard reaches, and a click scrolls there", () => {
  const root = sheet(POLICY);
  const scrolled: string[] = [];
  for (const heading of root.querySelectorAll("h1, h2, h3")) {
    (heading as HTMLElement).scrollIntoView = () =>
      scrolled.push(heading.textContent ?? "");
  }
  const undo = wireContentsLinks(root);
  const scope = root.querySelectorAll<HTMLElement>(".bs-toc-entry")[1]!;
  expect(scope.getAttribute("role")).toBe("link");
  expect(scope.getAttribute("tabindex")).toBe("0");

  scope.click();
  // The preloaded DOM has no KeyboardEvent; the page's own window does.
  const Keyboard = (
    root.ownerDocument.defaultView as Window & typeof globalThis
  ).KeyboardEvent;
  scope.dispatchEvent(new Keyboard("keydown", { key: "Enter", bubbles: true }));
  expect(scrolled).toEqual(["Scope", "Scope"]);

  undo();
  scope.click();
  expect(scrolled).toHaveLength(2);
  root.remove();
});

test("an entry whose heading is gone is left as text", () => {
  const root = sheet(
    '<div class="bs-toc"><p class="bs-toc-entry">Gone</p></div><p>No headings.</p>',
  );
  wireContentsLinks(root);
  expect(root.querySelector(".bs-toc-entry")?.getAttribute("role")).toBeNull();
  root.remove();
});
