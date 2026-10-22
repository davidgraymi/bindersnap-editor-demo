# infra/billing: what Bindersnap sells, in Stripe

The catalog (`catalog/`) is the Bindersnap product, its one price
(**$39 a month per writer seat**: each Owner, Admin and Editor, counted once;
reviewers and readers are free) and the customer portal. Two roots apply it,
each with its own state and its own key:

| Root                 | Stripe mode | Also owns                        | Used by                        |
| -------------------- | ----------- | -------------------------------- | ------------------------------ |
| `infra/billing`      | live        | the webhook endpoint             | production (`STRIPE_PRICE_ID`) |
| `infra/billing-test` | test        | nothing: CI uses `stripe listen` | the CI integration suite       |

See `main.tf` for what they deliberately do not own. Both need Terraform 1.11
or later.

The price is a per-unit, licensed, monthly price in USD, tax-exclusive
(Terms, Section 9). The API sets each subscription's quantity to the
organization's writer count (`services/api/stripe/seats.ts`).
`apply-all.sh` stores the price's ID in SSM as `stripe_price_id`, which the
deploy renders into `STRIPE_PRICE_ID`.

## The API keys

Stripe → Developers → API keys → **Create restricted key**, used only for
Terraform, once in live mode and once in test mode:

| Resource          | Permission |
| ----------------- | ---------- |
| Products          | Write      |
| Prices            | Write      |
| Webhook Endpoints | Write      |
| Customer portal   | Write      |

Everything else: None. Export the live one as `STRIPE_API_KEY` and the test
one as `STRIPE_TEST_API_KEY`; `apply-all.sh` hands the test key to
`infra/billing-test` as its `STRIPE_API_KEY`, and refuses to start if either
key is in the wrong mode. Never use an account secret key, and never the API's
own key from SSM.

The daily drift check (`.github/workflows/terraform-drift.yml`) needs the same
pair again with every row at **Read**, stored as the `STRIPE_API_KEY` and
`STRIPE_TEST_API_KEY` secrets of the `drift-check` environment.

## Cutover, once: live

The product, the webhook endpoint and the portal configuration were made by
hand in the Dashboard. `main.tf` imports them by ID, so the first apply adopts
them rather than making copies, and changes only what differs:

- the product is renamed from "Bindersnap Pro" to "Bindersnap" and gets the
  unit label "writer", so Checkout and invoices say "per writer";
- a new $39 per-seat price is created next to the old $90 flat one;
- the portal gets the Terms and Privacy links and a return URL that exists.

The webhook endpoint keeps its URL, events and API version (it gains only a
description), and so its signing secret: `stripe_webhook_secret` in SSM stays
valid. Importing it never reads the secret, so it is not in this module's
state.

Then:

```bash
cd infra/billing
terraform init -backend-config=../state/backend.hcl
terraform plan    # 3 to import, 1 to add (the price), 3 to change, 0 to destroy
terraform apply
```

and, in the Dashboard, once:

1. Products → Bindersnap → the $39 price → **Set as default price**.
2. The old $90 price → **Archive**. Stripe refuses to archive a product's
   default price, and the provider cannot change which price is the default,
   so this step is by hand. Nothing is subscribed to it.

Then run `infra/apply-all.sh` (or apply `infra/secrets` with
`stripe_price_id` set to `terraform output -raw seat_price_id`) and redeploy,
so the API sells the new price.

## Cutover, once: test mode

Test mode already had a "Bindersnap Pro Test" product with a $39 per-writer
price, which CI buys through the `STRIPE_TEST_PRICE_ID` secret.
`infra/billing-test/main.tf` imports the product, that price and the portal,
so the price keeps its ID: its amount, currency and interval already match,
and its tax behavior, lookup key and nickname change in place.

```bash
cd infra/billing-test
STRIPE_API_KEY="$STRIPE_TEST_API_KEY" terraform init -backend-config=../state/backend.hcl
STRIPE_API_KEY="$STRIPE_TEST_API_KEY" terraform plan   # 3 to import, 0 to add, 3 to change, 0 to destroy
STRIPE_API_KEY="$STRIPE_TEST_API_KEY" terraform apply
```

CI (`pr-verify.yml`, "Find the Stripe test price") then finds the price by its
lookup key, `bindersnap_writer_seat_monthly`, and stops using
`STRIPE_TEST_PRICE_ID`. Delete that secret once a run's log shows no
"Falling back" warning.

Left alone, and safe to archive or delete in the Dashboard: the test product's
old $90 price, the `myproduct` objects the Stripe CLI made, and a disabled
test-mode webhook endpoint that points at the production API.

## Changing the price

A price's amount never changes in Stripe. Changing `seat_unit_amount_cents`
in `catalog/main.tf` creates a new price in both modes, moves the lookup key
to it (so CI follows at once), points `STRIPE_PRICE_ID` at it on the next
`apply-all.sh`, and archives the old one. Existing subscriptions stay on the
old price, and the seat sync leaves them alone until each is moved by hand,
**after** the 30 days' notice the Terms (Section 9) promise. Change the
pricing page in the same commit; `services/api/stripe/terraform.test.ts`
fails until the two agree.

## Changing the API version

`api_version` can only be set when an endpoint is created, so a change here
would replace the endpoint, write its new signing secret into state, and break
`STRIPE_WEBHOOK_SECRET`. `prevent_destroy` stops that plan. Instead:

1. Bump `STRIPE_API_VERSION` in `services/api/stripe/api-version.ts` and
   `stripe_api_version` in `main.tf` together (the test holds them equal).
2. In the Dashboard, create a new endpoint on the same URL, events and new
   version, and write its signing secret over the old one in SSM (not with
   `put-secrets.sh --rotate`, which replaces every secret):

   ```bash
   aws ssm put-parameter --name /bindersnap/prod/stripe_webhook_secret \
     --type SecureString --key-id alias/bindersnap-prod-ssm --overwrite \
     --value "$(read -rs s && echo "$s")"
   ```

   Redeploy.

3. Delete the old endpoint, then swap the ID in the `import` block, run
   `terraform state rm stripe_webhook_endpoint.api`, and apply.

## Checking it

- `terraform plan` shows no changes in either root.
- Stripe → Products → Bindersnap shows one active price, $39.00 USD per writer
  per month, as the default.
- Stripe → Webhooks → `https://api.bindersnap.com/stripe/webhook` lists the
  six events in `main.tf`, at `2025-06-30.basil`.
- Settings → Billing → Customer portal shows cancellation at the end of the
  period and subscription updates off.
