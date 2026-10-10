# Edge module: everything Cloudflare does in front of the EC2 host.
#
#   - the Cloudflare Tunnel that carries api.bindersnap.com to the host, and
#     its route (the host has no inbound ports; see infra/compute)
#   - the DNS records this module owns: api (→ the tunnel) and www
#   - zone settings: HTTPS only, TLS 1.2+
#   - a www → apex redirect and a rate limit on the sign-in endpoints
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

# ---------- Outputs ----------

output "tunnel_id" {
  description = "ID of the bindersnap-prod tunnel (put-tunnel-token.sh reads it)"
  value       = cloudflare_zero_trust_tunnel_cloudflared.prod.id
}

output "cloudflare_account_id" {
  description = "Cloudflare account ID (put-tunnel-token.sh reads it)"
  value       = var.cloudflare_account_id
}
