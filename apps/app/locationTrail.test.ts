import { expect, test } from "bun:test";

import { buildLocationTrail } from "./locationTrail";
import { getRoute } from "./routes";

/** The trail for an address, the way the top bar computes it. */
function trailFor(address: string) {
  const url = new URL(address, "http://app.test");
  return buildLocationTrail(getRoute(url.pathname), url.search);
}

const labels = (address: string) =>
  trailFor(address).steps.map((step) => step.label);

test("a policy names its binder and its folders, which the page never did", () => {
  const trail = trailFor(
    "/riverside-health/clinical/nursing/wards/handover-standard",
  );

  expect(trail.steps).toEqual([
    { label: "Clinical", href: "/riverside-health/clinical" },
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
    labels("/riverside-health/clinical/training/hipaa-training-policy.docx"),
  ).toEqual(["Clinical", "Training", "HIPAA Training Policy"]);
  expect(
    labels(
      "/riverside-health/clinical/code-of-conduct.01J8XZ4K7MQ9V3B0RN7YHS2E1D.pdf",
    ),
  ).toEqual(["Clinical", "Code Of Conduct"]);
});

test("a change request is under its binder's change requests, and links back up", () => {
  const trail = trailFor("/riverside-health/clinical?tab=changes&change=4");

  expect(trail.steps).toEqual([
    { label: "Clinical", href: "/riverside-health/clinical" },
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

  expect(trail.steps.map((step) => step.label)).toEqual([
    "Clinical",
    "Change requests",
    "Change 4",
    "Compare",
  ]);
  expect(trail.steps[2]!.href).toBe(
    "/riverside-health/clinical?tab=changes&change=4",
  );
  expect(trail.steps[3]!.href).toBeNull();
});

test("a policy read on a change's branch keeps the way back to the change", () => {
  expect(
    labels(
      "/riverside-health/clinical/nursing/hand-hygiene?ref=upload%2Fx&change=7",
    ),
  ).toEqual([
    "Clinical",
    "Change requests",
    "Change 7",
    "Nursing",
    "Hand Hygiene",
  ]);
  expect(labels("/riverside-health/clinical?ref=upload%2Fx&change=7")).toEqual([
    "Clinical",
    "Change requests",
    "Change 7",
    "Proposed files",
  ]);
});

test("each of a binder's screens is one step under the binder", () => {
  expect(labels("/riverside-health/clinical?tab=history")).toEqual([
    "Clinical",
    "History",
  ]);
  expect(labels("/riverside-health/clinical?tab=settings")).toEqual([
    "Clinical",
    "Settings",
  ]);
  // Old addresses for what are now sections of Settings land on Settings.
  expect(labels("/riverside-health/clinical?tab=people")).toEqual([
    "Clinical",
    "Settings",
  ]);
  expect(labels("/riverside-health/clinical?tab=sign-off")).toEqual([
    "Clinical",
    "Settings",
  ]);
  expect(labels("/riverside-health/clinical?archive=1")).toEqual([
    "Clinical",
    "Archive",
  ]);
  expect(labels("/riverside-health/clinical?edit=1")).toEqual([
    "Clinical",
    "Editing",
  ]);
  expect(labels("/riverside-health/clinical?edit=propose")).toEqual([
    "Clinical",
    "Propose changes",
  ]);
});

test("the binder's own contents are the last step, and not a link", () => {
  expect(trailFor("/riverside-health/clinical").steps).toEqual([
    { label: "Clinical", href: null },
  ]);
});

test("the organization's binder list is the organization itself", () => {
  expect(trailFor("/riverside-health")).toEqual({
    steps: [],
    organizationIsCurrent: true,
  });
  // A typed or reloaded address carries the tab in the query only.
  expect(labels("/riverside-health?tab=people")).toEqual(["People"]);
});

test("pages across the organization name themselves once", () => {
  expect(labels("/changes")).toEqual(["Change requests"]);
  expect(labels("/documents")).toEqual(["Documents"]);
  expect(labels("/activity")).toEqual(["Activity"]);
  expect(labels("/billing")).toEqual(["Billing"]);
  // Home greets you itself; a step saying "Home" would be a second name for it.
  expect(labels("/")).toEqual([]);
});
