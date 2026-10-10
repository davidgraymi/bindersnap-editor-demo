# Billing, test mode: the same catalog as the live account (../billing/catalog),
# in the test mode of the same Stripe account. The CI integration suite
# (.github/workflows/pr-verify.yml) checks out against it, and finds the price
# by its lookup key, so nobody copies a price ID into a GitHub secret.
#
# No webhook endpoint: CI forwards events with `stripe listen`, which makes its
# own signing secret for each run (tests/README.md).
#
# Usage:
#   export STRIPE_API_KEY=rk_test_...   # see ../billing/README.md
#   cd infra/billing-test
#   terraform init -backend-config=../state/backend.hcl
#   terraform apply
#
# apply-all.sh runs this with STRIPE_TEST_API_KEY as the provider's key.

terraform {
  required_version = ">= 1.11" # write-only arguments, in the catalog
  required_providers {
    stripe = {
      source  = "stripe/stripe"
      version = "~> 0.3.0"
    }
  }

  backend "s3" {
    key = "billing-test/terraform.tfstate"
  }
}

provider "stripe" {
  # Reads STRIPE_API_KEY from the environment: a test key. The catalog checks.
}

module "catalog" {
  source = "../billing/catalog"

  livemode = false
}

# Made in the Dashboard as "Bindersnap Pro Test", with a $39 per-writer price
# that CI already buys (STRIPE_TEST_PRICE_ID). Adopted, so that price keeps its
# ID: its amount, currency and interval match the catalog, and what differs
# (tax behavior, lookup key, nickname) changes in place.
import {
  to = module.catalog.stripe_product.bindersnap
  id = "prod_UO9J4oQd4kOHVp"
}

import {
  to = module.catalog.stripe_price.writer_seat
  id = "price_1UOLeP3jaZJpAjcalmyX8wBT"
}

import {
  to = module.catalog.stripe_billing_portal_configuration.default
  id = "bpc_1Rs2SD3jaZJpAjcaXSadDBi0"
}

output "seat_price_id" {
  description = "The test price CI checks out with"
  value       = module.catalog.seat_price_id
}

output "seat_lookup_key" {
  description = "How CI finds seat_price_id"
  value       = module.catalog.seat_lookup_key
}
