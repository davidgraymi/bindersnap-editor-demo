/**
 * Give every `bun test` process a DOM before any module loads.
 *
 * react-dom decides once, at module-evaluation time, whether it is running in
 * a browser. With no `window` in scope at that moment it permanently disables
 * its `input` event handling — so a component test can click a button but can
 * never type into a controlled input. Test files that build their own JSDOM in
 * `beforeEach` are too late if some *earlier* file in the run already pulled
 * react-dom in, which makes the failure depend on file ordering.
 *
 * Installing a baseline `window`/`document` here settles it for the whole run.
 * Suites that want a clean document per test still swap in their own JSDOM;
 * this only guarantees react-dom sees a DOM at import time. Only the two
 * globals react-dom reads at load are set, so server-side suites keep Bun's
 * own `Event`, `fetch`, and friends.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://bindersnap.com/",
});

for (const [key, value] of [
  ["window", dom.window],
  ["document", dom.window.document],
] as const) {
  if ((globalThis as Record<string, unknown>)[key] === undefined) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
    });
  }
}
