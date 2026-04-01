import { serve } from "bun";
import index from "./index.html";
import appIndex from "./app/index.html";

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function isAutoLoginEnabled(): boolean {
  const explicitValue = process.env.BINDERSNAP_DEV_AUTO_LOGIN;
  if (explicitValue !== undefined) {
    return parseBoolean(explicitValue);
  }

  return process.env.NODE_ENV !== "production";
}

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 * Stripe sends: stripe-signature: t=<timestamp>,v1=<sig>[,v1=<sig2>...]
 * We compute HMAC-SHA256(secret, "<timestamp>.<rawBody>") and compare.
 */
async function verifyStripeSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(
      signature.split(",").map((part) => {
        const eq = part.indexOf("=");
        return [part.slice(0, eq), part.slice(eq + 1)];
      }),
    );

    const timestamp = parts["t"];
    const expectedSigs = signature.split(",")
      .filter((p) => p.startsWith("v1="))
      .map((p) => p.slice(3));

    if (!timestamp || expectedSigs.length === 0) return false;

    const payload = `${timestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const computed = Buffer.from(mac).toString("hex");

    return expectedSigs.some((sig) => sig === computed);
  } catch {
    return false;
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const devAutoLoginEnabled = isAutoLoginEnabled();
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const giteaInternalUrl =
  process.env.GITEA_INTERNAL_URL ??
  process.env.VITE_GITEA_URL ??
  process.env.BUN_PUBLIC_GITEA_URL ??
  "http://localhost:3000";
const giteaAdminUser = process.env.GITEA_ADMIN_USER ?? "";
const giteaAdminPass = process.env.GITEA_ADMIN_PASS ?? "";
const configuredPort = Number.parseInt(process.env.PORT ?? process.env.APP_PORT ?? "5173", 10);
const appPort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5173;

const server = serve({
  port: appPort,
  routes: {
    "/api/dev/gitea-token": {
      async POST() {
        if (!devAutoLoginEnabled) {
          return new Response("Not Found", { status: 404 });
        }

        if (!giteaAdminUser || !giteaAdminPass) {
          return jsonResponse(500, {
            error: "Missing GITEA_ADMIN_USER/GITEA_ADMIN_PASS for dev auto-login.",
          });
        }

        const tokenName = `bindersnap-ui-${Date.now()}`;
        const auth = Buffer.from(`${giteaAdminUser}:${giteaAdminPass}`).toString("base64");

        let response: Response;
        try {
          response = await fetch(
            new URL(`/api/v1/users/${encodeURIComponent(giteaAdminUser)}/tokens`, giteaInternalUrl),
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                name: tokenName,
                scopes: ["all"],
              }),
            },
          );
        } catch {
          return jsonResponse(502, {
            error: "Unable to reach Gitea while creating a dev token.",
          });
        }

        if (!response.ok) {
          return jsonResponse(502, {
            error: `Gitea token creation failed with status ${response.status}.`,
          });
        }

        const payload = (await response.json()) as { sha1?: unknown };
        if (typeof payload.sha1 !== "string" || payload.sha1.trim() === "") {
          return jsonResponse(502, {
            error: "Gitea returned no token value.",
          });
        }

        return jsonResponse(200, { token: payload.sha1 });
      },
    },

    "/stripe/webhook": {
      async POST(req) {
        if (!stripeWebhookSecret) {
          console.warn("[stripe] STRIPE_WEBHOOK_SECRET is not set — webhook signature verification skipped.");
        }

        const rawBody = await req.text();

        // Verify Stripe signature when secret is configured.
        if (stripeWebhookSecret) {
          const signature = req.headers.get("stripe-signature") ?? "";
          const isValid = await verifyStripeSignature(rawBody, signature, stripeWebhookSecret);
          if (!isValid) {
            console.warn("[stripe] Invalid webhook signature.");
            return new Response("Forbidden", { status: 403 });
          }
        }

        let event: { type?: string; data?: { object?: Record<string, unknown> } };
        try {
          event = JSON.parse(rawBody) as typeof event;
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data?.object ?? {};
          console.log("[stripe] checkout.session.completed:", JSON.stringify({
            id: session.id,
            customer: session.customer,
            customer_email: session.customer_email,
            amount_total: session.amount_total,
            currency: session.currency,
            payment_status: session.payment_status,
          }));
        } else {
          console.log(`[stripe] Received unhandled event type: ${event.type ?? "unknown"}`);
        }

        return new Response("OK", { status: 200 });
      },
    },

    "/app": appIndex,
    "/app/*": appIndex,

    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async (req) => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at http://localhost:${appPort}/`);
