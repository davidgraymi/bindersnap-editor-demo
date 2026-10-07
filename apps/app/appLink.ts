/**
 * Links that are links.
 *
 * Every destination in the app's navigation used to be a `<button>` that moved
 * the address bar in JavaScript. It went to the right place, and nothing else
 * a link does worked: no address on hover, no "Open in new tab", no
 * middle-click, no copying the link to send to a colleague. A policy manager
 * comparing two policies opens the second in a tab, the way they would on any
 * other site — GitHub and GitLab draw every destination as an `<a>` for
 * exactly this reason.
 *
 * So a destination is an `<a href>`, and a plain left click is intercepted
 * and handled in-app. Anything with a modifier, or any other button, is left
 * to the browser.
 */

import type { MouseEvent } from "react";

/** Whether this click is one the browser should handle itself. */
export function isModifiedClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * Follow a link inside the app, unless the reader asked for a new tab.
 *
 * `go` does the in-app navigation. It is only called for a plain left click;
 * everything else falls through to the browser, which knows what to do with
 * an `href`.
 */
export function followInApp(
  event: MouseEvent<HTMLAnchorElement>,
  go: () => void,
): void {
  if (isModifiedClick(event)) return;
  event.preventDefault();
  go();
}

/**
 * Move the address bar to `href`, and tell the app it moved.
 *
 * The same two steps every in-app navigation takes: the app re-reads its
 * route on `popstate`, so pushing without dispatching one leaves the page
 * rendering the address you just left.
 */
export function navigateToHref(href: string): void {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
