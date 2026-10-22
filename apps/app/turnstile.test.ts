import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { mountTurnstile } from "./turnstile";

/**
 * Turnstile as it behaves in the browser: one widget per container, and a
 * second render into the same one is rejected with the first widget's id.
 */
function fakeTurnstile() {
  const live = new Map<
    string,
    { container: HTMLElement; callback: (token: string) => void }
  >();
  let next = 0;
  return {
    live,
    render(
      container: HTMLElement,
      options: { callback: (token: string) => void },
    ): string {
      for (const [id, widget] of live) {
        if (widget.container === container) return id;
      }
      const id = `cf-chl-widget-${next++}`;
      live.set(id, { container, callback: options.callback });
      return id;
    },
    reset() {},
    remove(id: string) {
      live.delete(id);
    },
  };
}

describe("mountTurnstile", () => {
  let turnstile: ReturnType<typeof fakeTurnstile>;

  beforeEach(() => {
    turnstile = fakeTurnstile();
    (window as { turnstile?: unknown }).turnstile = turnstile;
  });

  afterEach(() => {
    delete (window as { turnstile?: unknown }).turnstile;
  });

  test("a second mount in the same container survives the first one's removal", async () => {
    const container = document.createElement("div");
    const tokens: Array<string | null> = [];

    // An effect that runs, is cleaned up, and runs again before Turnstile has
    // answered: the first mount is removed only once it resolves.
    const first = mountTurnstile(container, "site-key", () => {});
    const second = mountTurnstile(container, "site-key", (token) =>
      tokens.push(token),
    );
    (await first).remove();
    await second;

    expect(turnstile.live.size).toBe(1);
    const [widget] = turnstile.live.values();
    widget!.callback("token-1");
    expect(tokens).toEqual(["token-1"]);
  });

  test("removing the current mount takes its widget away", async () => {
    const container = document.createElement("div");
    const mounted = await mountTurnstile(container, "site-key", () => {});
    expect(turnstile.live.size).toBe(1);
    mounted.remove();
    expect(turnstile.live.size).toBe(0);
  });
});
