import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { STRIPE_API_VERSION } from "./api-version";

// infra/billing describes the Stripe side of what this code expects, in live
// mode (main.tf) and, through the same catalog, in the test mode CI buys from
// (infra/billing-test). Nothing at runtime checks that they agree, so these
// tests do.
const repoRoot = join(import.meta.dir, "..", "..", "..");
const read = (...path: string[]) =>
  readFileSync(join(repoRoot, ...path), "utf8");

const billingTf = read("infra", "billing", "main.tf");
const catalogTf = read("infra", "billing", "catalog", "main.tf");
const billingTestTf = read("infra", "billing-test", "main.tf");
const serverTs = read("services", "api", "server.ts");

function tfString(tf: string, name: string): string {
  const match = tf.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (!match) throw new Error(`${name} not found`);
  return match[1]!;
}

function tfNumber(tf: string, name: string): number {
  const match = tf.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`));
  if (!match) throw new Error(`${name} not found`);
  return Number(match[1]);
}

function tfWebhookEvents(): string[] {
  const block = billingTf.match(/webhook_events\s*=\s*\[([^\]]*)\]/);
  if (!block) throw new Error("webhook_events not found in main.tf");
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
}

function handledWebhookEvents(): string[] {
  const start = serverTs.indexOf("async function handleStripeWebhook(");
  if (start < 0) throw new Error("handleStripeWebhook not found");
  const end = serverTs.indexOf("\nasync function ", start + 1);
  const body = serverTs.slice(start, end < 0 ? undefined : end);
  return [
    ...new Set([...body.matchAll(/type === "([a-z_.]+)"/g)].map((m) => m[1]!)),
  ].sort();
}

describe("infra/billing", () => {
  it("pins the webhook endpoint to the API version the code reads", () => {
    expect(tfString(billingTf, "stripe_api_version")).toBe(STRIPE_API_VERSION);
  });

  it("subscribes the webhook to exactly the events the API handles", () => {
    const handled = handledWebhookEvents();
    expect(handled.length).toBeGreaterThan(0);
    expect(tfWebhookEvents()).toEqual(handled);
  });

  it("charges per writer seat what the pricing page says, in dollars", () => {
    const pricing = read("apps", "site", "content", "pages", "pricing.md");
    const price = pricing.match(/^price:\s*(\d+)\s*$/m);
    expect(price).not.toBeNull();
    expect(Number(price![1]) * 100).toBe(
      tfNumber(catalogTf, "seat_unit_amount_cents"),
    );
    expect(tfString(catalogTf, "seat_currency")).toBe("usd");
  });

  it("sells the same catalog in live and test mode", () => {
    const catalogSource = /module "catalog" \{\s*source\s*=\s*"([^"]+)"/;
    expect(billingTf.match(catalogSource)?.[1]).toBe("./catalog");
    expect(billingTestTf.match(catalogSource)?.[1]).toBe("../billing/catalog");
    expect(billingTf).toMatch(/livemode\s*=\s*true/);
    expect(billingTestTf).toMatch(/livemode\s*=\s*false/);
  });

  it("is where CI looks for the test price", () => {
    const workflow = read(".github", "workflows", "pr-verify.yml");
    const lookupKey = tfString(catalogTf, "seat_lookup_key");
    expect(workflow).toContain(`lookup_keys[]=${lookupKey}`);
  });
});
