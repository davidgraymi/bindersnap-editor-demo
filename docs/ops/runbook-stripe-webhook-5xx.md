# Runbook: Stripe Webhook 5xx Alert

**Alarm**: `bindersnap-stripe-webhook-5xx`  
**Trigger**: ≥1 `stripe_webhook_5xx` log line in any 5-minute window  
**Severity**: Medium — Stripe will retry, but repeated failures block subscription state updates

---

## What triggered this alert

The API returned HTTP 500 from `POST /stripe/webhook`. Stripe treats 5xx as a signal to retry (up to 3 days with exponential back-off), so no event is permanently lost. However, if the underlying cause persists, subscription activations or status changes will be delayed.

---

## Step 1 — Find the failing event(s)

Query CloudWatch Logs Insights on log group `/bindersnap/api`:

```
fields @timestamp, event_id, event_type, customer_id, error, username, subscriptionId
| filter stripe_webhook_5xx = 1
| sort @timestamp desc
| limit 20
```

Note the `event_type` and `error` fields — these point directly to the cause.

---

## Step 2 — Common causes and fixes

### `checkout.session.completed` → Stripe API call failed

**Symptom**: `error` field contains a Stripe API error (rate limit, network timeout, invalid API key).

**Check**:

```
# On the EC2 host
docker logs bindersnap-api-prod --since 30m | grep stripe_webhook_5xx
```

**Actions**:

- If transient (timeout, 503 from Stripe): wait for Stripe to retry automatically.
- If `Authentication` error: verify `STRIPE_SECRET_KEY` in SSM (`/bindersnap/prod/stripe_secret_key`) matches the live key in the Stripe dashboard.
- If `No such subscription` from Stripe: the subscription may have been deleted on the Stripe side. Check Stripe Dashboard → Subscriptions for `subscriptionId` from the log.

### Unexpected panic / unhandled error

**Symptom**: no `error` field, or a JavaScript stack trace.

**Check**: look for log lines immediately before the `stripe_webhook_5xx` entry:

```
fields @timestamp, level, message, error
| filter @timestamp between <start> and <end>
| sort @timestamp asc
```

**Action**: file a bug with the full log context.

---

## Step 3 — Check Stripe retry queue

1. Open [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks).
2. Select the endpoint for `api.bindersnap.com/stripe/webhook`.
3. Under **Recent deliveries**, find the failing event and confirm Stripe is scheduling retries.
4. If Stripe has already exhausted retries (unlikely under 24 h), use **Resend** to replay the event once the underlying fix is in.

---

## Step 4 — Manual subscription reconciliation (if needed)

If a user reports they paid but their account is not active, reconcile manually via the Stripe Dashboard:

1. Find the customer in Stripe → copy `customer_id`.
2. Verify the subscription is `active` in Stripe.
3. SSH to the EC2 host (or use SSM Session Manager) and run:

```bash
docker exec bindersnap-api-prod \
  bun run /app/scripts/reconcile-subscription.ts --customer <customer_id>
```

_(Script must be authored before use; if not present, update the subscription row directly in SQLite as a last resort — see `docs/ops/deploy.md` for DB access instructions.)_

---

## Step 5 — Resolve the alarm

The alarm auto-resolves when no `stripe_webhook_5xx` lines appear for one 5-minute evaluation period. If you have fixed the underlying issue and want to suppress further pages, use the AWS console to temporarily set the alarm to **OK** state.

---

## Escalation

- **Stripe retries will cover up to 3 days** — no immediate data loss for a short outage.
- If the error persists >30 minutes during business hours, escalate to @davidgraymi.
- If `STRIPE_SECRET_KEY` is suspected compromised, rotate immediately in Stripe Dashboard and update SSM before restarting the API container.
