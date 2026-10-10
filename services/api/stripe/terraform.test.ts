import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { STRIPE_API_VERSION } from "./api-version";

// infra/billing/main.tf describes the Stripe side of what this code expects.
// Nothing at runtime checks that the two agree, so these tests do.
const repoRoot = join(import.meta.dir, "..", "..", "..");
const billingTf = readFileSync(
  join(repoRoot, "infra", "billing", "main.tf"),
  "utf8",
);
const serverTs = readFileSync(
  join(repoRoot, "services", "api", "server.ts"),
  "utf8",
);

function tfLocalString(name: string): string {
  const match = billingTf.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (!match) throw new Error(`local ${name} not found in main.tf`);
  return match[1]!;
}

function tfLocalNumber(name: string): number {
  const match = billingTf.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`));
  if (!match) throw new Error(`local ${name} not found in main.tf`);
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
    expect(tfLocalString("stripe_api_version")).toBe(STRIPE_API_VERSION);
  });

  it("subscribes the webhook to exactly the events the API handles", () => {
    const handled = handledWebhookEvents();
    expect(handled.length).toBeGreaterThan(0);
    expect(tfWebhookEvents()).toEqual(handled);
  });

  it("charges per writer seat what the pricing page says, in dollars", () => {
    const pricing = readFileSync(
      join(repoRoot, "apps", "site", "content", "pages", "pricing.md"),
      "utf8",
    );
    const price = pricing.match(/^price:\s*(\d+)\s*$/m);
    expect(price).not.toBeNull();
    expect(Number(price![1]) * 100).toBe(
      tfLocalNumber("seat_unit_amount_cents"),
    );
    expect(tfLocalString("seat_currency")).toBe("usd");
  });
});
