import { expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { withQueryClient } from "./data/testing";
import { nameFor, usePeopleNames } from "./usePeopleNames";

test("a login is called by the name its person has", () => {
  const names = new Map([["carol", "Carol Mendes"]]);
  expect(nameFor(names, "carol")).toBe("Carol Mendes");
  expect(nameFor(names, "Carol")).toBe("Carol Mendes");
});

test("without a name, the login stands in, capitalized", () => {
  expect(nameFor(null, "carol")).toBe("Carol");
  expect(nameFor(new Map(), "jsmith")).toBe("Jsmith");
});

test("every screen asking at once shares one request", async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(
      JSON.stringify({
        organization: "riverside",
        people: [{ login: "carol", fullName: "Carol Mendes" }],
        groups: [],
        binders: [],
        canManage: false,
        viewer: "alice",
      }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const Name = () =>
    createElement("span", null, nameFor(usePeopleNames("riverside"), "carol"));

  try {
    flushSync(() =>
      root.render(
        withQueryClient(
          createElement(Fragment, null, [
            createElement(Name, { key: "history" }),
            createElement(Name, { key: "latest-change" }),
            createElement(Name, { key: "header" }),
          ]),
        ),
      ),
    );
    for (let tries = 0; tries < 50; tries += 1) {
      if (container.textContent === "Carol Mendes".repeat(3)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(container.textContent).toBe("Carol Mendes".repeat(3));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEndWith("/api/app/orgs/riverside/people");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    globalThis.fetch = realFetch;
  }
});
