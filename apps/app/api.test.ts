import { expect, test } from "bun:test";

function runApiCheck(script: string) {
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

test("getWorkspaceDocuments redirects to billing after a 402 response", () => {
  const result = runApiCheck(`
    import { JSDOM } from "jsdom";
    import { getWorkspaceDocuments } from "./apps/app/api.ts";
    import { registerPaymentRequiredHandler } from "./apps/app/paymentRequired.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async () =>
        new Response(JSON.stringify({ error: "Billing required." }), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });

    let handlerCalls = 0;
    const unregister = registerPaymentRequiredHandler(() => {
      handlerCalls += 1;
      window.history.replaceState({}, "", "/billing");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    try {
      await getWorkspaceDocuments();
      console.error("expected getWorkspaceDocuments to reject");
      process.exit(1);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Billing required.") {
        console.error("unexpected error", error);
        process.exit(1);
      }
    } finally {
      unregister();
    }

    if (handlerCalls !== 1) {
      console.error("expected handlerCalls=1 but got", handlerCalls);
      process.exit(1);
    }

    if (window.location.pathname !== "/billing") {
      console.error("expected redirect to /billing but got", window.location.pathname);
      process.exit(1);
    }
  `);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
});

test("fetchBillingStatus ignores 402 interception for billing endpoints", () => {
  const result = runApiCheck(`
    import { JSDOM } from "jsdom";
    import { fetchBillingStatus } from "./apps/app/api.ts";
    import { registerPaymentRequiredHandler } from "./apps/app/paymentRequired.ts";

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://bindersnap.com/documents",
    });

    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      history: dom.window.history,
      PopStateEvent: dom.window.PopStateEvent,
      fetch: async () =>
        new Response(JSON.stringify({ status: "past_due" }), {
          status: 402,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });

    let handlerCalls = 0;
    const unregister = registerPaymentRequiredHandler(() => {
      handlerCalls += 1;
    });

    const billing = await fetchBillingStatus();
    unregister();

    if (handlerCalls !== 0) {
      console.error("expected handlerCalls=0 but got", handlerCalls);
      process.exit(1);
    }

    if (window.location.pathname !== "/documents") {
      console.error("unexpected redirect to", window.location.pathname);
      process.exit(1);
    }

    if (billing.status !== "past_due") {
      console.error("expected status past_due but got", billing.status);
      process.exit(1);
    }
  `);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
});
