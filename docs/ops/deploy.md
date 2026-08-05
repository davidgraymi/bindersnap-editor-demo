# Production Deploys

Production now has two deploy surfaces:

1. [`../../.github/workflows/pages.yml`](../../.github/workflows/pages.yml) publishes the unified SPA to GitHub Pages at `https://bindersnap.com`.
2. [`../../.github/workflows/deploy-pyinfra.yml`](../../.github/workflows/deploy-pyinfra.yml) drives the full production host with pyinfra over an SSH-through-SSM tunnel on every push to `main`. See [`../../deploy/README.md`](../../deploy/README.md).

The production host workflow assumes the AWS role provisioned by [`../../infra/ci/oidc.tf`](../../infra/ci/oidc.tf).

> **Deploy failing or a bad change shipped?** See the break-glass runbook:
> [`break-glass.md`](break-glass.md) — recover the host directly over SSM without
> the CI pipeline.

## GitHub Pages SPA

Pushes to `main` build `apps/app/index.html` directly into `dist/`, then the workflow:

1. injects `BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com`
2. copies `dist/index.html` to `dist/404.html` for the GitHub Pages SPA fallback
3. writes `dist/CNAME` with `bindersnap.com`
4. uploads `dist/` as the Pages artifact

The published app is the single SPA:

- `/` shows the landing experience for signed-out users
- `/`, `/docs/*`, `/inbox`, and `/activity` all hydrate from the same bundle
- deep links rely on the `404.html` fallback, not S3 or CloudFront rewrites

Repository settings must point GitHub Pages at `GitHub Actions`, and the custom domain must be `bindersnap.com`.

## pyinfra Deploy Workflow

`deploy-pyinfra.yml` replaces the old SSM `send-command` deploy (`deploy.yml`,
removed in Phase 3, [#305](https://github.com/davidgraymi/bindersnap-editor-demo/issues/305)).

What it does on every push to `main`:

1. runs the API and ops unit suites
2. installs Python + the `deploy/requirements.txt` toolchain + the Session Manager plugin
3. assumes the production deploy role over GitHub OIDC
4. runs `deploy/bin/ssm-connect.sh`, which resolves the tagged host, pushes an
   ephemeral EC2 Instance Connect key, tunnels SSH through `aws ssm start-session`,
   and runs `pyinfra deploy/inventory.py deploy/deploy.py`

`deploy.py` is idempotent: it installs Docker, mounts the EBS data volume,
uploads the `deploy/files/` runtime config, renders `.env.prod` from SSM
Parameter Store (read on the control plane), validates the compose + Caddy config,
brings the stack up — force-recreating only when config or secrets changed —
and configures the CloudWatch agent for disk/memory metrics.

Trigger a manual dry run with `workflow_dispatch` and `dry_run=true` (passes
`--dry` to pyinfra: it reports changes without applying them). The connection
uses no inbound port 22 and no long-lived AWS keys.

> The S3 config-as-code path (`deploy-config.yml`, `infra/config-bucket/`) was
> retired in Phase 4 ([#306](https://github.com/davidgraymi/bindersnap-editor-demo/issues/306)):
> pyinfra is the only path that configures the host, and Terraform user-data
> does nothing beyond confirming the SSM agent. The serverless stack
> (Lambda/Aurora/API Gateway and the Gitea-as-NAT plumbing) was removed in
> Phase 5 ([#307](https://github.com/davidgraymi/bindersnap-editor-demo/issues/307)).
> The rationale for the whole model is recorded in
> [`../adr/0003-single-ec2-host-pyinfra-push-deploys.md`](../adr/0003-single-ec2-host-pyinfra-push-deploys.md).

## GitHub Configuration

Required repository variables:

- `BINDERSNAP_DEPLOY_ROLE_ARN`: IAM role ARN output by `infra/ci/oidc.tf`

Optional variables:

- `AWS_REGION`: defaults to `us-east-1`
- `BINDERSNAP_DEPLOY_TARGET_TAG_KEY`: defaults to `Project`
- `BINDERSNAP_DEPLOY_TARGET_TAG_VALUE`: defaults to `bindersnap`

The IAM trust policy allows two OIDC subject patterns: `refs/heads/main` (for pushes and manual dispatches from main) and `refs/tags/*` (for tag-triggered deploys). Both are managed by `infra/ci/oidc.tf`.

Do not add a GitHub Environment to the API deploy job unless you also change the IAM trust policy. GitHub switches the OIDC `sub` claim from a branch form to an environment form when an environment is attached.

## EC2 Prerequisites

The target instance requires no pre-configuration beyond what Terraform
provisions — the pyinfra deploy installs Docker, mounts the data volume, and
lays down all config on a fresh host. The remaining prerequisites are:

- It is managed by AWS Systems Manager (the SSM agent ships with AL2023).
- It matches the deploy target tag used by the workflow.
- `infra/secrets/terraform.tfvars` provided `gitea_admin_user` and `gitea_admin_pass` so the first deploy can mint `/bindersnap/prod/gitea_service_token` automatically before the API starts.
- The host can pull `ghcr.io/davidgraymi/bindersnap-api` (if the package is private, set the `GHCR_TOKEN` GitHub Actions secret so the deploy performs the registry login).

## Stripe Webhook Verification

Use this runbook whenever you change `Caddyfile.prod`, Stripe webhook handling,
or the production API deploy path.

### How to test the webhook end-to-end in staging

1. Confirm the staging Caddy proxy forwards both headers explicitly:
   `header_up X-Forwarded-Proto {scheme}` and `header_up X-Forwarded-For {remote}`.
2. Export the staging webhook secret locally:
   `export STRIPE_WEBHOOK_SECRET=whsec_...`
3. Build a small test payload and signature, then POST it directly to staging:
   `BODY='{"id":"evt_staging_manual","object":"event","type":"invoice.payment_failed","created":'$(date +%s)',"livemode":false,"data":{"object":{"id":"in_staging_manual","object":"invoice","customer":"cus_staging_manual"}}}'`
   `TS=$(date +%s)`
   `SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$STRIPE_WEBHOOK_SECRET" | awk '{print $NF}')`
   `curl --fail-with-body -H "content-type: application/json" -H "stripe-signature: t=$TS,v1=$SIG" --data-binary "$BODY" https://<staging-api-host>/stripe/webhook`
4. Expect `200` with `{"received":true}` and confirm the staging API logs show
   `Stripe webhook received`.
5. If the delivery fails with `400 HTTPS is required.`, treat that as a
   forwarded-proto regression in the Caddy path before looking at Stripe
   signature or payload handling.
6. If the delivery fails with `400 Invalid signature.`, re-check that the
   staging webhook secret matches the endpoint configured in Stripe.

## Rollback

The pyinfra deploy always applies the stack as defined at the deployed commit,
so the primary rollback path is to revert in git: revert the offending commit on
`main` (or run `deploy-pyinfra.yml` via `workflow_dispatch` selecting an earlier
ref) and let the resulting deploy re-apply the known-good stack.

If GitHub Actions is unavailable, the manual fallback on the instance pins the
API image directly:

```bash
cd /opt/bindersnap
python3 - <<'PY'
from pathlib import Path

api_tag = "REPLACE_WITH_OLD_SHA"
path = Path("/opt/bindersnap/.env.prod")
lines = path.read_text().splitlines()
updated = False
new_lines = []

for line in lines:
    if line.startswith("API_TAG="):
        new_lines.append(f"API_TAG={api_tag}")
        updated = True
    else:
        new_lines.append(line)

if not updated:
    new_lines.append(f"API_TAG={api_tag}")

path.write_text("\n".join(new_lines) + "\n")
PY
docker compose --env-file /opt/bindersnap/.env.prod -f docker-compose.prod.yml pull api
docker compose --env-file /opt/bindersnap/.env.prod -f docker-compose.prod.yml up -d api
```

Config rollback is the same git revert: `deploy/files/` is the single source of
truth for runtime config, so reverting the offending commit and letting
`deploy-pyinfra.yml` run re-applies the prior config (and force-recreates the
stack because the files changed).

## Validation Checklist

- A push to `main` publishes the SPA to GitHub Pages from `dist/`.
- `dist/404.html` matches `dist/index.html` so deep links load the SPA shell.
- A push to `main` triggers `deploy-pyinfra.yml`, which validates the compose + Caddy config on the host before bringing the stack up.
- A forced test failure prevents the pyinfra deploy job from running.
- `deploy-pyinfra.yml` with `dry_run=true` reports pyinfra changes without applying them.
- Reverting a commit on `main` re-applies the prior known-good stack via pyinfra.
- The integration suite includes `tests/stripe-webhook-caddy.pw.ts`, which posts a signed event through the local Caddy proxy and expects `{"received":true}`.
