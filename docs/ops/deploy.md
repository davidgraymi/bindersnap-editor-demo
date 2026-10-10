# Production Deploys

Production now has two deploy surfaces:

1. [`../../.github/workflows/static-site.yml`](../../.github/workflows/static-site.yml) publishes the public site and the unified SPA to Cloudflare at `https://bindersnap.com`.
2. [`../../.github/workflows/deploy-pyinfra.yml`](../../.github/workflows/deploy-pyinfra.yml) drives the full production host with pyinfra over an SSH-through-SSM tunnel on every push to `main`. See [`../../deploy/README.md`](../../deploy/README.md).

The production host workflow assumes the AWS role provisioned by [`../../infra/ci/oidc.tf`](../../infra/ci/oidc.tf).

> **Deploy failing or a bad change shipped?** See the break-glass runbook:
> [`break-glass.md`](break-glass.md) — recover the host directly over SSM without
> the CI pipeline.

## The static site (Cloudflare)

Pushes to `main` build `apps/app/index.html` and the public site into `dist/`,
then `static-site.yml` runs `wrangler deploy`. `wrangler.jsonc` makes `dist/`
the static assets of the `bindersnap-site` Worker, which serves `bindersnap.com`.
The Worker runs no code of ours.

- Any path with no file (`/{org}/...`, `/-/login`) gets `index.html`
  (`not_found_handling: single-page-application`), with status 200.
- `apps/app/public/_headers` sets the response headers: `X-Frame-Options`,
  `frame-ancestors`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- `/pricing/` redirects to `/pricing`.

The workflow needs the `CLOUDFLARE_API_TOKEN` secret and the
`CLOUDFLARE_ACCOUNT_ID` variable in the `production` environment. To check a
build locally: `bun run build && bunx wrangler@4.149.0 dev`.

A rollback is `bunx wrangler@4.149.0 rollback` (or Workers → bindersnap-site →
Deployments in the dashboard). It is instant and needs no rebuild.

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
- `infra/secrets/put-secrets.sh` has set every secret in SSM (it generates `gitea_admin_pass` and the Gitea keys, and prompts for the Stripe ones), so the first deploy can mint `/bindersnap/prod/gitea_service_token` before the API starts. Secrets never go in a tfvars file or Terraform state; the deploy refuses any value still holding a `CHANGE_ME`-style placeholder.
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

## Patching

The host's packages follow one pinned AL2023 release, in
`deploy/files/al2023-release`. AWS publishes a new one every week or two
([release notes](https://docs.aws.amazon.com/linux/al2023/release-notes/relnotes.html)).

**Monthly, or the day a security advisory matters:**

1. Set `deploy/files/al2023-release` to the newest release and merge. The
   deploy that ships it runs `dnf upgrade` to that release once, with Docker,
   containerd and runc excluded, so no container restarts.
2. If the upgrade brought a new kernel, reboot in a quiet window:
   `sudo systemctl reboot` over SSM. The site is down for about two minutes;
   the stack starts on boot once `/data` is mounted.
3. Docker itself, when its advisory matters: over SSM, in a quiet window,
   `sudo dnf upgrade -y docker containerd runc`. Every container restarts.
   Then check `https://api.bindersnap.com/healthz`.

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
`deploy-pyinfra.yml` run re-applies the prior config (and recreates the
services whose files changed).

### Gitea version changes are not covered by a git revert

Gitea runs its own database migrations against `/data/gitea.db` the first time a
new version boots, and those migrations are one-way — Gitea refuses to start
against a database stamped by a newer version. So bumping `gitea/gitea:<tag>` in
`deploy/files/docker-compose.prod.yml` is the one config change a `git revert`
alone cannot undo: reverting the tag brings back the old binary on top of an
already-migrated database and the container will fail to start.

**Dev and production run the same Gitea**, pinned by tag and digest in
`docker-compose.yml` and `deploy/files/docker-compose.prod.yml`. Change both in
one commit. Version 28.0.0 is the minimum: its `block_on_codeowner_reviews` is
what makes per-folder sign-off enforce anything.

Rolling a Gitea upgrade back means restoring the database too:

1. Revert the tag bump on `main` so the deploy stops pulling the newer image.
2. Stop the stack on the host, then restore `gitea.db` from a point in time
   before the upgrade with `scripts/restore.sh` (Litestream replicates it to S3
   continuously) or from the DLM snapshot of the EBS volume.
3. Bring the stack back up and confirm Gitea boots and `/api/v1/version`
   reports the older version.

Because of this, treat a Gitea bump as its own deploy: merge it on its own,
confirm the Litestream replica is current beforehand, and watch the container
come up rather than batching it with application changes.

### Starting production from nothing

This is how production moved from Gitea 1.27.3 to 28.0.0. Nobody migrated
anything; we erased the data and started again. Use it again only when every
organization, binder, account and session in production can be thrown away.
It is not a rollback.

The API's SQLite (`api-data`) goes with Gitea's (`gitea-data`). Its rows name
organizations and binders that will no longer exist.

1. Merge the change that needs the clean start. Then stop the stack on the host.
   The volume names are prefixed with the compose project, so list them first
   and remove the two that end in `gitea-data` and `api-data`:

   ```bash
   cd /opt/bindersnap
   docker compose --env-file .env.prod -f docker-compose.prod.yml down
   docker volume ls --format '{{.Name}}' | grep -E '(gitea|api)-data$'
   docker volume rm <the two names listed above>
   ```

2. Put both service-account tokens back to the bootstrap placeholder:

   ```bash
   for name in gitea_service_token gitea_admin_token; do
     aws ssm put-parameter --overwrite --type SecureString \
       --name "/bindersnap/prod/${name}" \
       --value "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"
   done
   ```

   `gitea_admin_user` and `gitea_admin_pass` must still be in SSM. The
   bootstrap creates the admin from them.

3. Re-run the deploy (`deploy-pyinfra.yml` → _Run workflow_, or
   `deploy/bin/ssm-connect.sh`). It renders the placeholder into `.env.prod`,
   and `bindersnap-bootstrap-gitea` boots an empty Gitea. That creates the
   admin and the `bindersnap-service` account, then mints the read and admin
   tokens into SSM and the env file. `bindersnap-stack-up` then starts the rest.

4. Check it came up: on the host (over SSM),
   `docker exec bindersnap-gitea-prod curl -s http://localhost:3000/api/v1/version`
   reports the new version, and a fresh signup creates an organization.
   Gitea has no public hostname.

Some old data survives the wipe:

- Litestream starts a new generation for each new database. It does not
  restore on start, so the stack cannot bring the old data back. The old
  generations stay in the S3 bucket until its lifecycle rule expires them.
- The DLM snapshots of the data volume still hold the old data.
- Stripe customers and subscriptions are not touched. A subscription that named
  an old organization belongs to nobody now. Cancel it in Stripe.

To truly erase the old data, delete those as well. Delete them only after
the new stack has been checked.

## Validation Checklist

- A push to `main` deploys `dist/` to the `bindersnap-site` Worker.
- A deep link such as `/-/login` loads the SPA shell, and `curl -I https://bindersnap.com` shows `x-frame-options: DENY`.
- A push to `main` triggers `deploy-pyinfra.yml`, which validates the compose + Caddy config on the host before bringing the stack up.
- A forced test failure prevents the pyinfra deploy job from running.
- `deploy-pyinfra.yml` with `dry_run=true` reports pyinfra changes without applying them.
- Reverting a commit on `main` re-applies the prior known-good stack via pyinfra.
- The integration suite includes `tests/stripe-webhook-caddy.pw.ts`, which posts a signed event through the local Caddy proxy and expects `{"received":true}`.
