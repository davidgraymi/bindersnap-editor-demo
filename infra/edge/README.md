# infra/edge: Cloudflare in front of the host

What it owns: the `bindersnap-prod` tunnel and its route, the `api` and `www`
DNS records, HTTPS-only and TLS settings, the www → apex redirect, the rate
limit on sign-in, Email Routing for every `@bindersnap.com` address, the SES
sending records, and the `bindersnap-backup` R2 bucket and its lock. See
`main.tf` for what it deliberately does not own.

## The API token

Create one in Cloudflare → My Profile → API Tokens → Custom token, used only
for Terraform:

| Scope   | Permission                                   |
| ------- | -------------------------------------------- |
| Account | Cloudflare Tunnel: Edit                      |
| Account | Email Routing Addresses: Edit                |
| Account | Workers R2 Storage: Edit (the backup bucket) |
| Account | Turnstile: Edit (optional, see below)        |
| Zone    | DNS: Edit                                    |
| Zone    | Zone Settings: Edit                          |
| Zone    | Single Redirect: Edit (the www → apex rule)  |
| Zone    | Zone WAF: Edit (for rate limits)             |
| Zone    | Email Routing Rules: Edit                    |

Limit it to the Bindersnap account and the `bindersnap.com` zone. Never use
the Global API Key. Cloudflare renamed Dynamic Redirects to Single Redirects;
the API calls the permission `Dynamic URL Redirects Write`.

Turnstile: Edit is only for `put-signup-turnstile-secret.sh`. Add it here, or
give that script a token of its own with nothing else.

The daily drift check (`terraform-drift.yml`) uses a second token with every
permission above at Read, in the `drift-check` environment's
`CLOUDFLARE_API_TOKEN`.

**Keep this token in your password manager, not in GitHub, SSM, `.env` or a
shell profile.** Nothing in CI applies this module, so only the machine
running `apply-all.sh` or the `put-*.sh` scripts needs it, and only for that
run:

```bash
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -s bindersnap-cloudflare-terraform -w)"
```

(That reads it from the macOS Keychain; `op read …` does the same from
1Password.) Close the shell when the apply is done.

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
CLOUDFLARE_ACCOUNT_ID=… ./put-signup-turnstile-secret.sh
                        # signup's Turnstile widget; secret → SSM
                        # /bindersnap/prod/signup_turnstile_secret_key
```

Cloudflare then emails `email_routing_destination` a verification link.
**Nothing is forwarded until it is clicked.**

Set the site key the second script prints as the `SIGNUP_TURNSTILE_SITE_KEY`
variable of the GitHub `production` environment.

Then redeploy the host. `cloudflared` and the API read the tunnel token and the
Turnstile secret from `.env.prod`, so the deploy fails at `compose config` until
both are in SSM.

## Checking it

- Zero Trust → Networks → Tunnels shows `bindersnap-prod` as **Healthy**.
- `curl -sI https://api.bindersnap.com/healthz` answers through Cloudflare
  (`server: cloudflare`).
- `curl -sI https://www.bindersnap.com/pricing` is a 301 to
  `https://bindersnap.com/pricing`.
- The instance's public IP answers nothing on 80 or 443.
- Email → Email Routing shows the destination as **Verified**, and a test
  message to `privacy@bindersnap.com` arrives in it.
