# infra/edge: Cloudflare in front of the host

What it owns: the `bindersnap-prod` tunnel and its route, the `api` and `www`
DNS records, HTTPS-only and TLS settings, the www → apex redirect, the rate
limit on sign-in, Email Routing for every `@bindersnap.com` address, and the
SES sending records. See `main.tf` for what it deliberately does not own.

## The API token

Create one in Cloudflare → My Profile → API Tokens → Custom token, used only
for Terraform:

| Scope   | Permission                       |
| ------- | -------------------------------- |
| Account | Cloudflare Tunnel: Edit          |
| Zone    | DNS: Edit                        |
| Zone    | Zone Settings: Edit              |
| Zone    | Dynamic Redirect: Edit           |
| Zone    | Zone WAF: Edit (for rate limits) |
| Zone    | Email Routing Rules: Edit        |
| Account | Email Routing Addresses: Edit    |

Limit it to the Bindersnap account and the `bindersnap.com` zone. Never use
the Global API Key.

## Cutover, once

The zone came from the old registrar with its old records. Before the first
apply, delete in Cloudflare → DNS:

- the apex `A`/`AAAA` records pointing at GitHub Pages (`185.199.108–111.153`,
  `2606:50c0:8000–8003::153`). `wrangler deploy` adds the Worker's own record
  and fails while these exist.
- `www` (a `CNAME` to `<user>.github.io`). This module recreates it.
- `api` and `gitea` (`A` records to the old Elastic IP). This module
  recreates `api` through the tunnel; `gitea` goes away for good.
- any SES records added by hand (`*._domainkey` CNAMEs, the `mail.` MX and
  SPF, `_dmarc`), and any MX records left over from the old registrar's mail
  forwarding. This module recreates the SES records from `infra/email`'s
  state, and Email Routing refuses to start while other MX records exist.

Apply `infra/email` first: this module reads its outputs.

Then:

```bash
cd infra/edge
terraform init -backend-config=../state/backend.hcl
terraform apply -var-file=terraform.tfvars
./put-tunnel-token.sh   # tunnel token → SSM /bindersnap/prod/cloudflare_tunnel_token
```

Cloudflare then emails `email_routing_destination` a verification link.
**Nothing is forwarded until it is clicked.**

Then redeploy the host. `cloudflared` reads the token from `.env.prod`, so
the deploy fails at `compose config` until the token is in SSM.

## Checking it

- Zero Trust → Networks → Tunnels shows `bindersnap-prod` as **Healthy**.
- `curl -sI https://api.bindersnap.com/healthz` answers through Cloudflare
  (`server: cloudflare`).
- `curl -sI https://www.bindersnap.com/pricing` is a 301 to
  `https://bindersnap.com/pricing`.
- The instance's public IP answers nothing on 80 or 443.
- Email → Email Routing shows the destination as **Verified**, and a test
  message to `privacy@bindersnap.com` arrives in it.
