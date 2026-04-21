# Production Deploys

Production now has two deploy surfaces:

1. [`../../.github/workflows/pages.yml`](../../.github/workflows/pages.yml) publishes the unified SPA to GitHub Pages at `https://bindersnap.com`.
2. [`../../.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) builds and deploys the API image over AWS OIDC + SSM.

Only the API workflow assumes the AWS role provisioned by [`../../infra/ci/oidc.tf`](../../infra/ci/oidc.tf).

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

Required repository variable:

- `BINDERSNAP_DEPLOY_ROLE_ARN`: IAM role ARN output by `infra/ci/oidc.tf`

Optional variables:

- `AWS_REGION`: defaults to `us-east-1`
- `BINDERSNAP_DEPLOY_TARGET_TAG_KEY`: defaults to `Project`
- `BINDERSNAP_DEPLOY_TARGET_TAG_VALUE`: defaults to `bindersnap`

Do not add a GitHub Environment to the API deploy job unless you also change the IAM trust policy. GitHub switches the OIDC `sub` claim from a branch form to an environment form when an environment is attached.

## EC2 Prerequisites

The target instance must already satisfy these conditions:

- It is managed by AWS Systems Manager.
- It matches the deploy target tag used by the workflow.
- `/opt/bindersnap` contains `docker-compose.prod.yml`, `Caddyfile.prod`, and `litestream.yml` (written by `user-data.sh.tftpl` at first boot — no git clone needed).
- `/opt/bindersnap/.env.prod` exists (generated from SSM Parameter Store by the `bindersnap-refresh-env` systemd service at boot).
- `infra/secrets/terraform.tfvars` provided `gitea_admin_user` and `gitea_admin_pass` so the first boot can mint `/bindersnap/prod/gitea_service_token` automatically before the API starts.
- `infra/apply-all.sh apply` can reach the instance through AWS Systems Manager so it can run the bootstrap flow remotely on existing instances after the secrets module updates.
- Docker and the Compose plugin are installed (handled by `user-data.sh.tftpl`).
- The host can pull `ghcr.io/davidgraymi/bindersnap-api` (if the package is private, add `ghcr_token` and optionally `ghcr_user` to the SSM parameters under `/bindersnap/prod/`).

The SSM command uses the same production compose contract documented in [`../../README.md`](../../README.md) and established by [`../../infra/compute/user-data.sh.tftpl`](../../infra/compute/user-data.sh.tftpl).

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

## Validation Checklist

- A push to `main` publishes the SPA to GitHub Pages from `dist/`.
- `dist/404.html` matches `dist/index.html` so deep links load the SPA shell.
- A forced test failure prevents the API deploy job from running.
- The API workflow log prints SSM stdout and stderr from the remote deploy command.
- A manual `api_tag` rollback returns the API to the selected SHA.
