# Stripe Subscription Integration

## Context

Bindersnap needs a $100/month subscription paywall gating all workspace features. The flow: sign up → session created → subscription check → if no active sub → `/billing` → Stripe Checkout → webhook stores subscription → redirect back → workspace unlocked. PR #82 designed this but targeted a different file structure; this plan ports the logic into the real codebase.

## Flow Diagram

```
Browser                 API (services/api/)          Stripe
  |                          |                          |
  |-- POST /auth/signup ---→ |                          |
  |←-- session cookie ------|                          |
  |                          |                          |
  |-- fetchBillingStatus → GET /api/app/billing/status  |
  |←-- { status: 'none' } --|                          |
  |                          |                          |
  | navigateTo('/billing')   |                          |
  |                          |                          |
  |-- createCheckout → POST /api/app/billing/checkout   |
  |                    → POST stripe.com/checkout/sessions
  |←-- { url } -------------|                          |
  |                          |                          |
  | window.location = url                               |
  |----------------------------------------→ Stripe UI  |
  |←------- redirect to /billing?checkout=success -----|
  |                                                      |
  | (poll fetchBillingStatus every 2s, max 10x)         |
  |                    ←-- POST /stripe/webhook --------|
  |                    upsert subscription record        |
  |                          |                          |
  |-- fetchBillingStatus → { status: 'active' }         |
  | navigateTo('/')          |                          |
```

## Pre-requisites (manual, before coding)

Do in Stripe Dashboard / CLI:

1. Create product "Bindersnap Pro" + price $100/month → copy **Price ID** (`price_...`)
2. Enable **Customer Portal**: Dashboard → Settings → Billing → Customer Portal
3. `stripe listen --forward-to localhost:8787/stripe/webhook --print-secret` → copy **webhook secret** (`whsec_...`)
4. Note **Secret Key** (`sk_test_...`) and **Publishable Key** (`pk_test_...`)

---

## Backend Changes

### New: `services/api/subscriptions.ts`

Follow `SessionStore` / `LazySessionStore` pattern from `sessions.ts` exactly. Uses the same DB path from `BINDERSNAP_SESSIONS_DB_PATH`.

```ts
export interface SubscriptionRecord {
  username: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string; // 'active' | 'canceled' | 'past_due' | 'trialing'
  currentPeriodEnd: number | null; // Unix seconds
  updatedAt: number;
}

export class SubscriptionStore {
  // Schema:
  // CREATE TABLE IF NOT EXISTS subscriptions (
  //   username TEXT PRIMARY KEY,
  //   stripe_customer_id TEXT NOT NULL,
  //   stripe_subscription_id TEXT NOT NULL,
  //   status TEXT NOT NULL,
  //   current_period_end INTEGER,
  //   updated_at INTEGER NOT NULL
  // );
  // CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);

  getByUsername(username: string): SubscriptionRecord | null;
  getByCustomerId(customerId: string): SubscriptionRecord | null;
  upsert(record: SubscriptionRecord): void;
}

class LazySubscriptionStore {
  /* wraps SubscriptionStore lazily */
}

export const subscriptionStore = new LazySubscriptionStore();

export function hasActiveSubscription(username: string): boolean {
  const record = subscriptionStore.getByUsername(username);
  if (!record) return false;
  return record.status === "active" || record.status === "trialing";
}
```

### New: `services/api/stripe/webhook.ts`

HMAC-SHA256 signature verification (no SDK, uses Web Crypto via `crypto.subtle`):

```ts
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean>;
// Parses "t=<timestamp>,v1=<hex_sig>" format.
// Validates: timestamp within tolerance, HMAC-SHA256(secret, `${t}.${rawBody}`) === sig.
```

### New: `services/api/stripe/webhook.test.ts`

Unit tests: valid signature, tampered body, wrong secret, expired timestamp, multiple v1 sigs, malformed header, missing t= field, empty body.

### Modify: `services/api/server.ts`

**New env vars** (add near existing env reads at top of file):

```ts
const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
const stripePriceId = process.env.STRIPE_PRICE_ID?.trim() ?? "";
const appOrigin = (
  process.env.BINDERSNAP_APP_ORIGIN ??
  process.env.BINDERSNAP_ALLOWED_ORIGINS?.split(",")[0] ??
  defaultAppOrigin
).trim();

if (isProduction && !stripeSecretKey) {
  logger.error("FATAL: STRIPE_SECRET_KEY is not set in production");
  process.exit(1);
}
```

**New helper: `requireSubscription`** (replaces `requireSession` calls for all document/app routes):

```ts
function requireSubscription(
  req: Request,
  baseHeaders: Headers,
): { session: SessionRecord; client: GiteaClient } | Response {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;
  if (!hasActiveSubscription(auth.session.username)) {
    return json(402, { error: "Subscription required." }, baseHeaders);
  }
  return auth;
}
```

**New helper: `stripeFetch`** (raw Stripe API calls):

```ts
async function stripeFetch(
  path: string,
  body?: URLSearchParams,
): Promise<Response> {
  return fetch(`https://api.stripe.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
}
```

**Webhook bypass for `enforceStateChangingOrigin`**: The Stripe webhook is a POST from Stripe's servers (not our allowed origin). Add this early-return in the main `fetch` handler, before the origin check runs:

```ts
// Inside createApiServer().fetch(), after transport check, before origin check:
if (pathname === "/stripe/webhook" && method === "POST") {
  response = await handleStripeWebhook(req, baseHeaders);
  // ... log + return
}
```

**New route handlers:**

`handleStripeWebhook(req, baseHeaders)`:

- Read raw body: `const rawBody = await req.text()`
- Verify signature with `verifyStripeSignature(rawBody, req.headers.get("stripe-signature") ?? "", stripeWebhookSecret)`
- Parse event: `JSON.parse(rawBody)`
- Handle `checkout.session.completed`: read `client_reference_id` (username), `customer`, `subscription` → fetch `GET /v1/subscriptions/{id}` → upsert record
- Handle `customer.subscription.updated` / `customer.subscription.deleted`: look up by `customer` → update status

`handleBillingStatus(req, baseHeaders)` — `GET /api/app/billing/status`:

- `requireSession` only (not subscription)
- Return `{ status: record?.status ?? null, currentPeriodEnd: record?.currentPeriodEnd ?? null }`

`handleBillingCheckout(req, baseHeaders)` — `POST /api/app/billing/checkout`:

- `requireSession` only
- POST to `https://api.stripe.com/v1/checkout/sessions` with form-encoded body:
  - `mode=subscription`, `line_items[0][price]={stripePriceId}`, `line_items[0][quantity]=1`
  - `client_reference_id={username}`, `success_url={appOrigin}/billing?checkout=success`, `cancel_url={appOrigin}/billing`
- Return `{ url: session.url }`

`handleBillingPortal(req, baseHeaders)` — `POST /api/app/billing/portal`:

- `requireSession` only (portal works even if subscription just lapsed)
- Look up `stripeCustomerId` from subscriptionStore
- POST to `https://api.stripe.com/v1/billing_portal/sessions`
- Return `{ url: session.url }`

**Route dispatch additions** (in the main `if/else` chain):

```
GET  /api/app/billing/status   → handleBillingStatus
POST /api/app/billing/checkout → handleBillingCheckout
POST /api/app/billing/portal   → handleBillingPortal
```

**Switch document handlers from `requireSession` to `requireSubscription`**:
All handlers in the `/api/app/documents*` and `/api/app/users/search` dispatch branches. That's these functions:

- `handleDocuments` (line 1653)
- `handleCreateDocument` (line 1721)
- `handleDocumentDetail` (line 1872)
- `handleDocumentVersions` (line 1967)
- `handleDocumentReview` (line 2108)
- `handleDocumentPublish` (line 2167)
- `handleDocumentDownload` (line 2227)
- `handleDocumentCollaborators` (line 2305)
- `handleSearchUsersRoute` (line 2350)
- `handleAddCollaborator` (line 2383)
- `handleDeleteCollaborator` (line 2453)

---

## Frontend Changes

### Modify: `apps/app/routes.ts`

Add to `AppRoute` union:

```ts
| { kind: "billing" }
```

Add to `getRoute()`:

```ts
if (normalizedPath === "/billing") return { kind: "billing" };
```

Add to `routeToPath()`:

```ts
case "billing": return "/billing";
```

Do NOT add to `isProtectedAppRoute()` — billing is reachable with session but without subscription.

### Modify: `apps/app/api.ts`

Add three functions using the existing `requestJson` helper:

```ts
export async function fetchBillingStatus(): Promise<{
  status: string | null;
  currentPeriodEnd: number | null;
}> {
  const response = await fetch(resolveApiUrl("/api/app/billing/status"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) return { status: null, currentPeriodEnd: null };
  const payload = await response.json().catch(() => null);
  return {
    status: payload?.status ?? null,
    currentPeriodEnd: payload?.currentPeriodEnd ?? null,
  };
}

export async function createCheckoutSession(): Promise<{ url: string }> {
  return requestJson<{ url: string }>(
    "/api/app/billing/checkout",
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
    "Unable to start checkout.",
  );
}

export async function createPortalSession(): Promise<{ url: string }> {
  return requestJson<{ url: string }>(
    "/api/app/billing/portal",
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
    "Unable to open billing portal.",
  );
}
```

### New: `apps/app/components/BillingPage.tsx`

Props:

```ts
interface BillingPageProps {
  subscriptionStatus: "active" | "none" | "loading";
  currentPeriodEnd: number | null;
  onSubscribe: () => Promise<void>;
  onManage: () => Promise<void>;
}
```

Two states:

- **Unsubscribed** (`status === 'none'` or `'loading'`): eyebrow "Bindersnap Pro", headline "Start your subscription", plan card ($100/month, features), coral CTA "Subscribe now" → calls `onSubscribe`; `?checkout=success` query param shows a "Payment received — activating your workspace…" banner + inline spinner while polling
- **Subscribed** (`status === 'active'`): headline "Your subscription", shows renewal date, "Manage subscription" → calls `onManage`, "Return to workspace" link

On `?checkout=success`: call `fetchBillingStatus()` on a 2-second interval, max 10 retries; when `active`, call `onSubscriptionConfirmed()` prop → parent navigates to home. Abort polling on unmount.

All styling uses design tokens: `--color-paper`, `--color-coral`, `--space-*`, `--radius-*`, `--font-*` — no hardcoded hex or px values.

### Modify: `apps/app/App.tsx`

**New state:**

```ts
const [subscriptionStatus, setSubscriptionStatus] = useState<
  "active" | "none" | "loading" | null
>(null);
const [currentPeriodEnd, setCurrentPeriodEnd] = useState<number | null>(null);
```

**Update `AuthView` type:**

```ts
type AuthView =
  | "loading"
  | "callback"
  | "landing"
  | "login"
  | "billing"
  | "app";
```

**Update `refreshSession`** — after `setUser(nextSession?.user ?? null)`, if user is non-null:

```ts
const billing = await fetchBillingStatus();
setSubscriptionStatus(
  billing.status === "active" || billing.status === "trialing"
    ? "active"
    : billing.status === null
      ? null
      : "none",
);
setCurrentPeriodEnd(billing.currentPeriodEnd);
```

**Add new route guard** (in the existing guard `useEffect` alongside the login/signup guards):

```ts
const isCheckoutSuccess = window.location.search.includes("checkout=success");

if (user && subscriptionStatus === "none" && route.kind !== "billing") {
  navigateTo({ kind: "billing" }, true);
  return;
}

if (
  user &&
  subscriptionStatus === "active" &&
  route.kind === "billing" &&
  !isCheckoutSuccess
) {
  navigateTo({ kind: "home" }, true);
  return;
}
```

Add `subscriptionStatus` to this effect's dependency array.

**Update `view` computation** (in the `useMemo`):

```ts
if (route.kind === "billing" && user) return "billing";
```

Insert before the final `return user ? "app" : "login"`.

**Add billing view render branch** (after the `"loading"` check):

```ts
if (view === "billing") {
  return (
    <BillingPage
      subscriptionStatus={subscriptionStatus ?? 'loading'}
      currentPeriodEnd={currentPeriodEnd}
      onSubscribe={async () => {
        const { url } = await createCheckoutSession();
        window.location.href = url;
      }}
      onManage={async () => {
        const { url } = await createPortalSession();
        window.location.href = url;
      }}
      onSubscriptionConfirmed={() => navigateTo({ kind: 'home' }, true)}
    />
  );
}
```

---

## Environment Variables

**`tests/.env.example`** additions:

```
# Stripe (required for subscription paywall)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from: stripe listen --forward-to localhost:8787/stripe/webhook --print-secret
STRIPE_PRICE_ID=price_...         # $100/month price ID from Stripe Dashboard
```

**`.env.prod.example`** additions:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

---

## Critical Files

| File                                  | Action                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api/subscriptions.ts`       | Create                                                                                                                                         |
| `services/api/stripe/webhook.ts`      | Create                                                                                                                                         |
| `services/api/stripe/webhook.test.ts` | Create                                                                                                                                         |
| `services/api/server.ts`              | Modify: new env vars, `requireSubscription`, `stripeFetch`, webhook handler, billing handlers, route dispatch, bypass origin check for webhook |
| `apps/app/routes.ts`                  | Modify: add `billing` to union, `getRoute`, `routeToPath`                                                                                      |
| `apps/app/api.ts`                     | Modify: add `fetchBillingStatus`, `createCheckoutSession`, `createPortalSession`                                                               |
| `apps/app/components/BillingPage.tsx` | Create                                                                                                                                         |
| `apps/app/App.tsx`                    | Modify: subscription state, `billing` view, redirect guards                                                                                    |
| `tests/.env.example`                  | Modify: add Stripe vars                                                                                                                        |
| `.env.prod.example`                   | Modify: add Stripe vars                                                                                                                        |

---

## Verification

1. `stripe listen --forward-to localhost:8787/stripe/webhook` running in terminal
2. `bun run up` + `bun run dev:api` + `bun run dev:app`
3. Sign up → confirm immediate redirect to `/billing`
4. Click **Subscribe** → confirm redirect to Stripe hosted checkout
5. Complete test payment (card `4242 4242 4242 4242`) → API logs show webhook received
6. Confirm redirect to `/billing?checkout=success` → polling detects `active` → workspace opens
7. Navigate to `/billing` from workspace → **Manage subscription** visible
8. Click **Manage** → Stripe Customer Portal opens
9. Cancel subscription in portal → webhook fires → next visit redirects to `/billing`
10. `curl -b "bindersnap_session=<valid-session>" http://localhost:8787/api/app/documents` with no subscription → expect `402 Subscription required`
11. `bun run test` → all existing tests pass (webhook tests added pass too)
