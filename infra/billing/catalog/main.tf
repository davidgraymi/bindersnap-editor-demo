# What Bindersnap sells, in one Stripe mode: the product, its one price, and
# the customer portal. infra/billing uses it for the live account and
# infra/billing-test for its test mode, which the CI integration suite buys
# from, so a test checkout sells exactly what a real one does.
#
#   - the price: $39 a month for each writer seat. A seat is an Owner, Admin
#     or Editor (ADR 0004); reviewers and readers are free, so they are never
#     a quantity on this price. The API sets the quantity
#     (services/api/stripe/seats.ts).
#   - the portal: invoices, card, cancel at the end of the period. The seat
#     count is not the customer's to change, so updates are off.
#
# The caller imports the objects that already exist; see its main.tf.

terraform {
  required_version = ">= 1.11" # write-only arguments (transfer_lookup_key)
  required_providers {
    stripe = {
      source = "stripe/stripe"
    }
  }
}

variable "livemode" {
  description = "Which mode the provider's key must be in. A test key applied to the live root, or the reverse, stops at the product's postcondition."
  type        = bool
}

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

locals {
  # $39 a month per writer seat, before tax. Section 9 of the Terms: fees do
  # not include taxes; and the price on the pricing page.
  seat_unit_amount_cents = 3900
  seat_currency          = "usd"

  # How anything that is not the API finds the price without copying its ID:
  # CI (.github/workflows/pr-verify.yml) asks Stripe for it by this key.
  seat_lookup_key = "bindersnap_writer_seat_monthly"
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

  lifecycle {
    postcondition {
      condition     = self.livemode == var.livemode
      error_message = "STRIPE_API_KEY is a ${self.livemode ? "live" : "test"} key, but this root manages ${var.livemode ? "live" : "test"} mode."
    }
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

  lookup_key = local.seat_lookup_key
  # A replacement price takes the key from the one it replaces; without this,
  # Stripe refuses a second price with the same key. Write-only: never stored.
  transfer_lookup_key = true

  metadata = {
    managed_by = "infra/billing"
    seat       = "owner, admin or editor"
  }

  lifecycle {
    # The replacement exists before STRIPE_PRICE_ID can point at it.
    create_before_destroy = true
  }
}

# The mode's default configuration, so every portal session the API opens uses
# it without naming it.
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

output "seat_price_id" {
  description = "STRIPE_PRICE_ID: the price checkout sells and the seat sync updates"
  value       = stripe_price.writer_seat.id
}

output "seat_lookup_key" {
  description = "The price's lookup key, for finding it without its ID"
  value       = stripe_price.writer_seat.lookup_key
}

output "product_id" {
  description = "The Bindersnap product"
  value       = stripe_product.bindersnap.id
}

output "portal_configuration_id" {
  description = "The default customer portal configuration"
  value       = stripe_billing_portal_configuration.default.id
}
