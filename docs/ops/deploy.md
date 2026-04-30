# Production Deploys

Production now has three deploy surfaces:

1. [`../../.github/workflows/pages.yml`](../../.github/workflows/pages.yml) publishes the unified SPA to GitHub Pages at `https://bindersnap.com`.
2. [`../../.github/workflows/deploy-config.yml`](../../.github/workflows/deploy-config.yml) publishes the runtime config bundle to `s3://${BINDERSNAP_CONFIG_BUCKET}/` and applies it on the EC2 host over AWS OIDC + SSM.
3. [`../../.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) builds and deploys the API image over AWS OIDC + SSM.

Both production host workflows assume the AWS role provisioned by [`../../infra/ci/oidc.tf`](../../infra/ci/oidc.tf).

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

## Config Deploy Workflow

The config workflow keeps `/opt/bindersnap` on the running host aligned with the tracked repo bundle:

- `docker-compose.prod.yml`
- `Caddyfile.prod`
- `litestream.yml`
- `Dockerfile.caddy`
- `scripts/bindersnap`
- `scripts/bootstrap-gitea-service-account.ts`

On pushes to `main` that touch any of those files, the workflow:

1. runs the ops suite
2. assumes the production deploy role over GitHub OIDC
3. uploads the tracked bundle to `s3://${BINDERSNAP_CONFIG_BUCKET}/`
4. sends an SSM Run Command that bootstraps the host CLI if needed, then runs:
   - `bindersnap config sync`
   - `bindersnap stack validate`
   - `bindersnap stack restart`
5. waits for the SSM invocation to finish and fails the workflow if the host validation or restart fails

`bindersnap stack validate` checks `docker compose ... config -q` and validates `Caddyfile.prod` using the repo's custom `Dockerfile.caddy` build, which includes the `rate_limit` module used in production.

The workflow also supports manual `workflow_dispatch`. Leave `publish_from_repo=true` for a normal re-apply, or set `publish_from_repo=false` to apply whatever object versions are already in S3 without overwriting them from the current repo state.

## API Deploy Workflow

The API workflow keeps the AWS-backed deploy path for `services/api`.

What it does:

1. runs the API and ops unit suites
2. builds and publishes `ghcr.io/davidgraymi/bindersnap-api:${GITHUB_SHA}`
3. on tag pushes or manual dispatch, uses SSM Run Command to:
   - update `API_TAG` in `/opt/bindersnap/.env.prod`
   - pull the pinned API image
   - restart the API with `docker-compose.prod.yml`
   - print container status back into the workflow logs

The workflow does not use SSH and does not require long-lived AWS keys in GitHub.

## GitHub Configuration

Required repository variables:

- `BINDERSNAP_DEPLOY_ROLE_ARN`: IAM role ARN output by `infra/ci/oidc.tf`
- `BINDERSNAP_CONFIG_BUCKET`: config bucket name (for example `bindersnap-config`)

Optional variables:

- `AWS_REGION`: defaults to `us-east-1`
- `BINDERSNAP_DEPLOY_TARGET_TAG_KEY`: defaults to `Project`
- `BINDERSNAP_DEPLOY_TARGET_TAG_VALUE`: defaults to `bindersnap`

The IAM trust policy allows two OIDC subject patterns: `refs/heads/main` (for pushes and manual dispatches from main) and `refs/tags/*` (for tag-triggered deploys). Both are managed by `infra/ci/oidc.tf`.

Do not add a GitHub Environment to the API deploy job unless you also change the IAM trust policy. GitHub switches the OIDC `sub` claim from a branch form to an environment form when an environment is attached.

## EC2 Prerequisites

The target instance must already satisfy these conditions:

- It is managed by AWS Systems Manager.
- It matches the deploy target tag used by the workflow.
- `/opt/bindersnap` contains the runtime bundle seeded by `user-data.sh.tftpl` on first boot, including `docker-compose.prod.yml`, `Caddyfile.prod`, `litestream.yml`, `Dockerfile.caddy`, and `scripts/bindersnap`.
- `/usr/local/bin/bindersnap` exists, or the legacy `/usr/local/bin/bindersnap-sync-config` helper still exists so the config workflow can bootstrap the CLI onto older hosts.
- `/opt/bindersnap/.env.prod` exists (generated from SSM Parameter Store by the `bindersnap-refresh-env` systemd service at boot).
- `infra/secrets/terraform.tfvars` provided `gitea_admin_user` and `gitea_admin_pass` so the first boot can mint `/bindersnap/prod/gitea_service_token` automatically before the API starts.
- `infra/apply-all.sh apply` can reach the instance through AWS Systems Manager so it can run the bootstrap flow remotely on existing instances after the secrets module updates.
- Docker and the Compose plugin are installed (handled by `user-data.sh.tftpl`).
- The host can pull `ghcr.io/davidgraymi/bindersnap-api` (if the package is private, add `ghcr_token` and optionally `ghcr_user` to the SSM parameters under `/bindersnap/prod/`).

The SSM command uses the same production compose contract documented in [`../../README.md`](../../README.md) and established by [`../../infra/compute/user-data.sh.tftpl`](../../infra/compute/user-data.sh.tftpl).

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

The rollback path is a manual run of the API deploy workflow:

1. Open the `Deploy Production` workflow in GitHub Actions.
2. Choose `Run workflow`.
3. Set `api_tag` to a previously published commit SHA.
4. Run the workflow.

That dispatch updates `API_TAG` in `/opt/bindersnap/.env.prod`, pulls the older image, and restarts only the API service.

If GitHub Actions is unavailable, the manual fallback on the instance is:

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

For config-only rollback, copy the prior object version back into place, then run the config workflow with `publish_from_repo=false` so it applies the bucket contents without re-uploading the current repo files:

```bash
CONFIG_BUCKET=your-config-bucket

aws s3api copy-object \
  --bucket "${CONFIG_BUCKET}" \
  --copy-source "${CONFIG_BUCKET}/<file>?versionId=<prior-version-id>" \
  --key <file>
```

After the copy completes:

1. Open the `Deploy Production Config` workflow in GitHub Actions.
2. Choose `Run workflow`.
3. Set `publish_from_repo` to `false`.
4. Run the workflow so the host re-syncs from S3 and reruns validation before restart.

## Validation Checklist

- A push to `main` publishes the SPA to GitHub Pages from `dist/`.
- `dist/404.html` matches `dist/index.html` so deep links load the SPA shell.
- A push to `main` touching a tracked runtime config file triggers `Deploy Production Config`, publishes to `s3://${BINDERSNAP_CONFIG_BUCKET}/`, and waits for `bindersnap config sync && bindersnap stack validate && bindersnap stack restart` to succeed on the host.
- Setting `publish_from_repo=false` on `Deploy Production Config` reapplies the existing S3 object versions instead of overwriting them from the current checkout.
- A forced test failure prevents the API deploy job from running.
- The API workflow log prints SSM stdout and stderr from the remote deploy command.
- A manual `api_tag` rollback returns the API to the selected SHA.
- The integration suite includes `tests/stripe-webhook-caddy.pw.ts`, which posts a signed event through the local Caddy proxy and expects `{"received":true}`.
