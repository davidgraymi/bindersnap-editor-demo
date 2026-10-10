# Billing module: what Bindersnap sells, as Stripe sees it.
#
#   - the product, and its one price: $39 a month for each writer seat. A seat
#     is an Owner, Admin or Editor (ADR 0004); reviewers and readers are free,
#     so they are never a quantity on this price. The API sets the quantity
#     (services/api/stripe/seats.ts).
#   - the webhook endpoint that tells the API about checkouts, subscriptions
#     and invoices, pinned to the API version the code reads
#   - the customer portal: invoices, card, cancel at the end of the period.
#     The seat count is not the customer's to change, so updates are off.
#
# Not here, on purpose:
#   - the API keys. The provider's own key is STRIPE_API_KEY in the
#     environment; the API's key and the webhook signing secret go straight to
#     SSM with infra/secrets/put-secrets.sh.
#   - the webhook signing secret. Stripe returns it only when an endpoint is
#     created, and a created endpoint would keep it in this module's state.
#     The endpoint was made in the Dashboard and is imported below, so its
#     secret was never returned here; prevent_destroy keeps it that way.
#   - customers and subscriptions. Those are records, written by checkout and
#     by the API, never by Terraform.
#
# Usage:
#   export STRIPE_API_KEY=rk_live_...   # see README.md for the permissions
#   cd infra/billing
#   terraform init -backend-config=../state/backend.hcl
#   terraform apply

terraform {
  required_version = ">= 1.5" # import blocks
  required_providers {
    stripe = {
      source  = "stripe/stripe"
      version = "~> 0.3.0"
    }
  }

  backend "s3" {
    key = "billing/terraform.tfstate"
  }
}

provider "stripe" {
  # Reads STRIPE_API_KEY from the environment. The key decides the mode: a
  # live key manages the live account, which is the only one this describes.
}

# ---------- Variables ----------

variable "app_origin" {
  description = "Origin of the app; the portal returns here when a session names no return URL (the API always names one)"
  type        = string
  default     = "https://bindersnap.com"
}

variable "site_origin" {
  description = "Origin of the public site, which serves the legal pages"
  type        = string
  default     = "https://bindersnap.com"
}

variable "api_hostname" {
  description = "Public hostname of the API, which receives the webhook"
  type        = string
  default     = "api.bindersnap.com"
}

# ---------- The price ----------

locals {
  # $39 a month per writer seat, before tax. Section 9 of the Terms: fees do
  # not include taxes; and the price on the pricing page.
  seat_unit_amount_cents = 3900
  seat_currency          = "usd"
}

# Made in the Dashboard as "Bindersnap Pro" before per-seat billing; adopted,
# not recreated, so its ID and tax code stay as they are.
import {
  to = stripe_product.bindersnap
  id = "prod_UO8ZC04Cilj7Eb"
}

resource "stripe_product" "bindersnap" {
  name        = "Bindersnap"
  description = "One seat for each Owner, Admin and Editor. Reviewers and readers are free."
  type        = "service"
  # Checkout, invoices and the portal say "per writer".
  unit_label = "writer"
  # Software as a service, business use.
  tax_code = "txcd_10103001"

  metadata = {
    managed_by = "infra/billing"
  }
}

# A price's amount, currency and interval never change in Stripe. Changing any
# of them here makes a new price and archives this one (the provider's delete
# sets active=false; Stripe never deletes a price). Existing subscriptions stay
# on the old price, and the seat sync leaves them alone (seats.ts, "no_item")
# until they are moved by hand, after the 30 days' notice Section 9 promises.
resource "stripe_price" "writer_seat" {
  product     = stripe_product.bindersnap.id
  currency    = local.seat_currency
  unit_amount = local.seat_unit_amount_cents
  nickname    = "Writer seat, monthly"
  # The Terms say fees do not include taxes. Fixed once set.
  tax_behavior   = "exclusive"
  billing_scheme = "per_unit"

  recurring {
    interval       = "month"
    interval_count = 1
    usage_type     = "licensed"
  }

  lookup_key = "bindersnap_writer_seat_monthly"

  metadata = {
    managed_by = "infra/billing"
    seat       = "owner, admin or editor"
  }

  lifecycle {
    # The replacement exists before the API's STRIPE_PRICE_ID can point at it.
    create_before_destroy = true
  }
}

# ---------- Webhook ----------

locals {
  # Must equal STRIPE_API_VERSION in services/api/stripe/api-version.ts: the
  # endpoint's version, not the request's, decides the shape of every event.
  stripe_api_version = "2025-06-30.basil"

  # Every event handleStripeWebhook in services/api/server.ts acts on.
  # services/api/stripe/terraform.test.ts holds the two lists together.
  webhook_events = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
    "invoice.payment_succeeded",
  ]
}

import {
  to = stripe_webhook_endpoint.api
  id = "we_1RstK13jaZJpAjcajt2gQShD"
}

resource "stripe_webhook_endpoint" "api" {
  url            = "https://${var.api_hostname}/stripe/webhook"
  description    = "Bindersnap API (managed by infra/billing)"
  enabled_events = local.webhook_events
  api_version    = local.stripe_api_version

  lifecycle {
    # api_version can only be set when an endpoint is created, so changing it
    # replaces the endpoint: a new signing secret, written into this module's
    # state, and a dead STRIPE_WEBHOOK_SECRET until SSM has the new one. Do
    # that by hand instead (README.md, "Changing the API version").
    prevent_destroy = true
  }
}

# ---------- Customer portal ----------

# The account's default configuration, so every portal session the API opens
# uses it without naming it.
import {
  to = stripe_billing_portal_configuration.default
  id = "bpc_1RpAIK3jaZJpAjcab5ucixBl"
}

resource "stripe_billing_portal_configuration" "default" {
  default_return_url = var.app_origin

  business_profile = {
    privacy_policy_url   = "${var.site_origin}/legal/privacy"
    terms_of_service_url = "${var.site_origin}/legal/terms"
  }

  # Lets an owner reach the portal from an emailed link, by the email the
  # subscription was bought with.
  login_page = {
    enabled = true
  }

  features = {
    customer_update = {
      enabled         = true
      allowed_updates = ["name", "email", "address", "phone"]
    }

    invoice_history = {
      enabled = true
    }

    payment_method_update = {
      enabled = true
    }

    # Section 9: cancellation takes effect at the end of the current billing
    # period, and paid fees are not refunded.
    subscription_cancel = {
      enabled            = true
      mode               = "at_period_end"
      proration_behavior = "none"
      cancellation_reason = {
        enabled = true
        options = [
          "too_expensive",
          "missing_features",
          "switched_service",
          "unused",
          "customer_service",
          "too_complex",
          "low_quality",
          "other",
        ]
      }
    }

    # The quantity is the organization's writer count, kept by the API. A
    # customer who changed it here would be billed for seats they don't have,
    # or not billed for ones they do, until the next sync undid it.
    subscription_update = {
      enabled = false
    }
  }
}

# ---------- Outputs ----------

output "seat_price_id" {
  description = "STRIPE_PRICE_ID: the price checkout sells and the seat sync updates (SSM leaf stripe_price_id, wired by apply-all.sh)"
  value       = stripe_price.writer_seat.id
}

output "product_id" {
  description = "The Bindersnap product"
  value       = stripe_product.bindersnap.id
}

output "webhook_endpoint_id" {
  description = "The API's webhook endpoint (its signing secret is SSM leaf stripe_webhook_secret, never here)"
  value       = stripe_webhook_endpoint.api.id
}

output "portal_configuration_id" {
  description = "The default customer portal configuration"
  value       = stripe_billing_portal_configuration.default.id
}
