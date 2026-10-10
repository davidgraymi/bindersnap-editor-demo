# Billing module: what Bindersnap sells, as the live Stripe account sees it.
#
#   - the catalog (./catalog): the product, its one price ($39 a month for
#     each writer seat) and the customer portal. infra/billing-test applies
#     the same catalog to test mode, for CI.
#   - the webhook endpoint that tells the API about checkouts, subscriptions
#     and invoices, pinned to the API version the code reads
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
  required_version = ">= 1.11" # write-only arguments, in ./catalog
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
  # Reads STRIPE_API_KEY from the environment: a live key. The catalog checks.
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

# ---------- Catalog ----------

module "catalog" {
  source = "./catalog"

  livemode    = true
  app_origin  = var.app_origin
  site_origin = var.site_origin
}

# Made in the Dashboard as "Bindersnap Pro" before per-seat billing; adopted,
# not recreated, so its ID stays. Its only price was $90 flat, so the seat
# price is new (README.md, "Cutover, once").
import {
  to = module.catalog.stripe_product.bindersnap
  id = "prod_UO8ZC04Cilj7Eb"
}

import {
  to = module.catalog.stripe_billing_portal_configuration.default
  id = "bpc_1RpAIK3jaZJpAjcab5ucixBl"
}

# Where these lived before the catalog was shared with test mode.
moved {
  from = stripe_product.bindersnap
  to   = module.catalog.stripe_product.bindersnap
}

moved {
  from = stripe_price.writer_seat
  to   = module.catalog.stripe_price.writer_seat
}

moved {
  from = stripe_billing_portal_configuration.default
  to   = module.catalog.stripe_billing_portal_configuration.default
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

# ---------- Outputs ----------

output "seat_price_id" {
  description = "STRIPE_PRICE_ID: the price checkout sells and the seat sync updates (SSM leaf stripe_price_id, wired by apply-all.sh)"
  value       = module.catalog.seat_price_id
}

output "product_id" {
  description = "The Bindersnap product"
  value       = module.catalog.product_id
}

output "webhook_endpoint_id" {
  description = "The API's webhook endpoint (its signing secret is SSM leaf stripe_webhook_secret, never here)"
  value       = stripe_webhook_endpoint.api.id
}

output "portal_configuration_id" {
  description = "The default customer portal configuration"
  value       = module.catalog.portal_configuration_id
}
