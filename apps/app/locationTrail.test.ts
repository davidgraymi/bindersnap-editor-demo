import { expect, test } from "bun:test";

import { buildLocationTrail } from "./locationTrail";
import { getRoute } from "./routes";

/** The trail for an address, the way the shell computes it. */
function trailFor(address: string) {
  const url = new URL(address, "http://app.test");
  return buildLocationTrail(getRoute(url.pathname), url.search);
}

const path = (address: string) =>
  trailFor(address).path.map((step) => step.label);

test("a policy's path is its folders, then itself", () => {
  const trail = trailFor(
    "/riverside-health/clinical/nursing/wards/handover-standard",
  );

  // The top bar names the binder, and links to it.
  expect(trail.binder).toEqual({
    label: "Clinical",
    href: "/riverside-health/clinical",
  });
  // The page names where in it: never the binder again.
  expect(trail.path).toEqual([
    // A folder has no page of its own, so it is named and not linked.
    { label: "Nursing", href: null },
    { label: "Wards", href: null },
    // The page you are on is never a link to itself.
    { label: "Handover Standard", href: null },
  ]);
  expect(trail.organizationIsCurrent).toBe(false);
});

test("a policy's name loses its extension and its identity segment", () => {
  expect(
    path("/riverside-health/clinical/training/hipaa-training-policy.docx"),
  ).toEqual(["Training", "HIPAA Training Policy"]);
  expect(
    path(
      "/riverside-health/clinical/code-of-conduct.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
    ),
  ).toEqual(["Code Of Conduct"]);
});

test("a change request is under its binder's change requests, and links back up", () => {
  const trail = trailFor("/riverside-health/clinical?tab=changes&change=4");

  expect(trail.binder?.href).toBe("/riverside-health/clinical");
  expect(trail.path).toEqual([
    {
      label: "Change requests",
      href: "/riverside-health/clinical?tab=changes",
    },
    { label: "Change 4", href: null },
  ]);
});

test("a change's comparison is one step under the change, which becomes a link", () => {
  const trail = trailFor(
    "/riverside-health/clinical?tab=changes&change=4&view=compare",
  );

  expect(trail.path.map((step) => step.label)).toEqual([
    "Change requests",
    "Change 4",
    "Changes",
  ]);
  expect(trail.path[1]!.href).toBe(
    "/riverside-health/clinical?tab=changes&change=4",
  );
  expect(trail.path[2]!.href).toBeNull();
});

test("a policy read on a change's branch keeps the way back to the change", () => {
  expect(
    path(
      "/riverside-health/clinical/nursing/hand-hygiene?ref=upload%2Fx&change=7",
    ),
  ).toEqual(["Change requests", "Change 7", "Nursing", "Hand Hygiene"]);
  expect(path("/riverside-health/clinical?ref=upload%2Fx&change=7")).toEqual([
    "Change requests",
    "Change 7",
    "Proposed files",
  ]);
});

test("each of a binder's screens is one step into the binder", () => {
  expect(path("/riverside-health/clinical?tab=history")).toEqual(["History"]);
  expect(path("/riverside-health/clinical?tab=settings")).toEqual(["Settings"]);
  // Old addresses for what are now sections of Settings land on Settings.
  expect(path("/riverside-health/clinical?tab=people")).toEqual(["Settings"]);
  expect(path("/riverside-health/clinical?tab=sign-off")).toEqual(["Settings"]);
  expect(path("/riverside-health/clinical?archive=1")).toEqual(["Archive"]);
  expect(path("/riverside-health/clinical?edit=1")).toEqual(["Editing"]);
  expect(path("/riverside-health/clinical?edit=propose")).toEqual([
    "Propose changes",
  ]);
  // Off its contents, the binder in the top bar is the way back to them.
  expect(trailFor("/riverside-health/clinical?tab=history").binder?.href).toBe(
    "/riverside-health/clinical",
  );
});

test("on the binder's own contents the binder is the page, and not a link", () => {
  expect(trailFor("/riverside-health/clinical")).toEqual({
    binder: { label: "Clinical", href: null },
    path: [],
    organizationIsCurrent: false,
  });
});

test("the organization's binder list is the organization itself", () => {
  expect(trailFor("/riverside-health")).toEqual({
    binder: null,
    path: [],
    organizationIsCurrent: true,
  });
  // A typed or reloaded address carries the tab in the query only.
  expect(trailFor("/riverside-health?tab=people").organizationIsCurrent).toBe(
    false,
  );
});

test("pages across the organization have no path: their title names them", () => {
  for (const address of ["/changes", "/documents", "/billing", "/"]) {
    expect(trailFor(address)).toEqual({
      binder: null,
      path: [],
      organizationIsCurrent: false,
    });
  }
});
