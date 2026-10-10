# Edge module: everything Cloudflare does in front of the EC2 host.
#
#   - the Cloudflare Tunnel that carries api.bindersnap.com to the host, and
#     its route (the host has no inbound ports; see infra/compute)
#   - the DNS records this module owns: api (→ the tunnel) and www
#   - zone settings: HTTPS only, TLS 1.2+
#   - a www → apex redirect and a rate limit on the sign-in endpoints
#   - inbound mail: Email Routing forwards privacy@, security@, team@,
#     notifications@ and anything else @bindersnap.com to one inbox
#   - the R2 bucket that holds the restic backups, and the lock that keeps any
#     credential from deleting a snapshot younger than 35 days
#   - the SES sending records (DKIM, MAIL FROM, DMARC), read from infra/email's
#     state so nobody copies them by hand
#
# Not here, on purpose:
#   - bindersnap.com itself. `wrangler deploy` (static-site.yml) creates the
#     apex record when it attaches the Worker's custom domain; two owners
#     would fight over it.
#   - the tunnel token. A data source would copy it into Terraform state.
#     `put-tunnel-token.sh` reads it from the Cloudflare API and writes it
#     straight to SSM, where the deploy renders it into .env.prod.
#
# Usage:
#   export CLOUDFLARE_API_TOKEN=...   # see README.md for the permissions
#   cd infra/edge
#   terraform init -backend-config=../state/backend.hcl
#   terraform apply -var-file=terraform.tfvars
#   ./put-tunnel-token.sh

terraform {
  required_version = ">= 1.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27"
    }
  }

  backend "s3" {
    key = "edge/terraform.tfstate"
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}

# ---------- Variables ----------

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (dashboard → Account home → the ID in the URL or the right column)"
  type        = string
}

variable "zone_id" {
  description = "Zone ID of bindersnap.com (dashboard → bindersnap.com → Overview → API)"
  type        = string
}

variable "zone_name" {
  description = "The apex domain"
  type        = string
  default     = "bindersnap.com"
}

variable "api_hostname" {
  description = "Public hostname of the API, routed through the tunnel to Caddy"
  type        = string
  default     = "api.bindersnap.com"
}

variable "state_bucket" {
  description = "The Terraform state bucket (the `bucket` in ../state/backend.hcl); infra/email's outputs are read from it"
  type        = string
}

variable "state_region" {
  description = "Region of the Terraform state bucket"
  type        = string
  default     = "us-east-1"
}

variable "email_routing_destination" {
  description = "The inbox that receives every address @bindersnap.com. Set it in terraform.tfvars (gitignored), never in code: this repository is public. Cloudflare emails it a verification link that must be clicked before anything is forwarded."
  type        = string
}

variable "origin_service" {
  description = "Where cloudflared sends api traffic, as seen from inside the Docker network"
  type        = string
  default     = "http://caddy:80"
}

# ---------- Tunnel ----------

# Remotely managed (config_src = "cloudflare"): the routes live here, not in a
# config file on the host. Cloudflare generates the tunnel secret, so it is not
# in this module's state.
resource "cloudflare_zero_trust_tunnel_cloudflared" "prod" {
  account_id = var.cloudflare_account_id
  name       = "bindersnap-prod"
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "prod" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.prod.id

  config = {
    ingress = [
      {
        hostname = var.api_hostname
        service  = var.origin_service
      },
      # Anything else that reaches the tunnel is refused.
      {
        service = "http_status:404"
      },
    ]
  }
}

# ---------- DNS ----------

resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = var.api_hostname
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.prod.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1 # automatic; required for proxied records
  comment = "Managed by infra/edge: the API, through the bindersnap-prod tunnel"
}

# www exists only to redirect (below). 100:: is the discard prefix: a proxied
# record needs some address, and Cloudflare answers before it is ever used.
resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.zone_name}"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
  comment = "Managed by infra/edge: redirects to the apex"
}

# ---------- Zone settings ----------

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = var.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = var.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "ssl" {
  zone_id    = var.zone_id
  setting_id = "ssl"
  # Nothing is fetched from an origin over the internet (the API comes through
  # the tunnel, the site is a Worker), so strict costs nothing and forbids
  # any future origin with a bad certificate.
  value = "strict"
}

# ---------- www → apex ----------

resource "cloudflare_ruleset" "redirects" {
  zone_id = var.zone_id
  name    = "bindersnap redirects"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [
    {
      description = "www.bindersnap.com to bindersnap.com"
      expression  = "(http.host eq \"www.${var.zone_name}\")"
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code           = 301
          preserve_query_string = true
          target_url = {
            expression = "concat(\"https://${var.zone_name}\", http.request.uri.path)"
          }
        }
      }
    },
  ]
}

# ---------- Rate limits ----------

# Stops a password-guessing or signup flood at the edge, before it costs the
# host anything. The API keeps its own, slower limit behind this one. The free
# plan allows one rule with a 10 s period and a 10 s block, counted per IP and
# data centre.
resource "cloudflare_ruleset" "rate_limits" {
  zone_id = var.zone_id
  name    = "bindersnap rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules = [
    {
      description = "Sign-in, signup and password reset"
      expression  = "(http.request.uri.path in {\"/auth/login\" \"/auth/signup\" \"/auth/password/forgot\" \"/auth/password/reset\" \"/auth/email/resend\"})"
      action      = "block"
      ratelimit = {
        characteristics     = ["ip.src", "cf.colo.id"]
        period              = 10
        requests_per_period = 10
        mitigation_timeout  = 10
      }
    },
  ]
}

# ---------- Inbound mail (Email Routing) ----------

# Turns Email Routing on for the apex and adds its MX and SPF records. SES
# sends from the `mail.` subdomain (infra/email), so the two never share an MX.
resource "cloudflare_email_routing_dns" "apex" {
  zone_id = var.zone_id
}

resource "cloudflare_email_routing_address" "inbox" {
  account_id = var.cloudflare_account_id
  email      = var.email_routing_destination
}

locals {
  # Every address the product or the legal pages publish. The catch-all below
  # forwards anything else too; these are listed so each one keeps working if
  # the catch-all is ever turned off.
  routed_addresses = toset(["privacy", "security", "team", "notifications", "dmarc"])
}

resource "cloudflare_email_routing_rule" "published" {
  for_each = local.routed_addresses

  zone_id = var.zone_id
  name    = "${each.key}@${var.zone_name}"
  enabled = true

  matchers = [{
    type  = "literal"
    field = "to"
    value = "${each.key}@${var.zone_name}"
  }]

  actions = [{
    type  = "forward"
    value = [cloudflare_email_routing_address.inbox.email]
  }]

  depends_on = [cloudflare_email_routing_dns.apex]
}

resource "cloudflare_email_routing_catch_all" "rest" {
  zone_id = var.zone_id
  name    = "everything else @${var.zone_name}"
  enabled = true

  matchers = [{ type = "all" }]

  actions = [{
    type  = "forward"
    value = [cloudflare_email_routing_address.inbox.email]
  }]

  depends_on = [cloudflare_email_routing_dns.apex]
}

# ---------- Outbound mail (SES records) ----------

data "terraform_remote_state" "email" {
  backend = "s3"
  config = {
    bucket = var.state_bucket
    key    = "email/terraform.tfstate"
    region = var.state_region
  }
}

# DKIM CNAMEs, the MAIL FROM MX and SPF, and DMARC, exactly as SES asked for
# them. DNS only: a proxied record would hide them from mail servers.
resource "cloudflare_dns_record" "ses" {
  for_each = {
    for record in data.terraform_remote_state.email.outputs.dns_records :
    "${record.type} ${record.name}" => record
  }

  zone_id = var.zone_id
  name    = each.value.name
  type    = each.value.type
  # An MX value arrives as "10 host"; Cloudflare takes the priority apart.
  content  = each.value.type == "MX" ? split(" ", each.value.value)[1] : each.value.value
  priority = each.value.type == "MX" ? tonumber(split(" ", each.value.value)[0]) : null
  proxied  = false
  ttl      = 1
  comment  = "Managed by infra/edge from infra/email: Amazon SES"
}

# ---------- Backups (R2) ----------

# The third backup copy (docs/ops/production-architecture.md §3): restic
# snapshots from deploy/files/bin/bindersnap-backup, encrypted on the host
# before they leave it, so R2 only ever holds ciphertext.
resource "cloudflare_r2_bucket" "backup" {
  account_id = var.cloudflare_account_id
  name       = "bindersnap-backup"
  # Eastern North America, next to us-east-1. A hint, not a guarantee.
  location = "enam"
}

locals {
  backup_lock_seconds = 35 * 24 * 60 * 60
}

# Locked prefixes are the ones restic never rewrites: data packs, snapshots,
# keys and the repository config. Nobody, holding any credential, can delete or
# overwrite them for 35 days. `index/` and `locks/` stay unlocked: restic
# deletes its own lock files after every run and replaces index files when it
# prunes, and a lost index is rebuilt from the packs (`restic repair index`).
resource "cloudflare_r2_bucket_lock" "backup" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.backup.name

  rules = [
    for prefix in ["data/", "snapshots/", "keys/", "config"] : {
      id      = "retain-35d-${trimsuffix(prefix, "/")}"
      enabled = true
      prefix  = prefix
      condition = {
        type            = "Age"
        max_age_seconds = local.backup_lock_seconds
      }
    }
  ]
}

# ---------- Outputs ----------

output "tunnel_id" {
  description = "ID of the bindersnap-prod tunnel (put-tunnel-token.sh reads it)"
  value       = cloudflare_zero_trust_tunnel_cloudflared.prod.id
}

output "cloudflare_account_id" {
  description = "Cloudflare account ID (put-tunnel-token.sh reads it)"
  value       = var.cloudflare_account_id
}

output "backup_repository" {
  description = "RESTIC_REPOSITORY for the SSM leaf restic_repository"
  value       = "s3:https://${var.cloudflare_account_id}.r2.cloudflarestorage.com/${cloudflare_r2_bucket.backup.name}"
}
