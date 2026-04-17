# Production Deploys

`git push origin main` is the production deploy path for the private app stack.
The workflow lives in [`../../.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) and assumes the AWS role provisioned by [`../../infra/ci/oidc.tf`](../../infra/ci/oidc.tf).

## What The Pipeline Does

1. Runs `bun run test`.
2. Builds and publishes `ghcr.io/davidgraymi/bindersnap-api:${GITHUB_SHA}`.
3. Builds `dist/app` with `BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com`.
4. Uploads the SPA bundle to S3 and invalidates CloudFront for `/` and `/index.html`.
5. Uses SSM Run Command to:
   - update `API_TAG` in `/opt/bindersnap/.env.prod`
   - pull the pinned API image
   - restart the API with `docker-compose.prod.yml`
   - print the container status back into the workflow logs

The workflow does not use SSH and does not require long-lived AWS keys in GitHub.

## GitHub Configuration

Set these repository-level variables before enabling the workflow:

- `BINDERSNAP_DEPLOY_ROLE_ARN`: IAM role ARN output by `infra/ci/oidc.tf`
- `BINDERSNAP_SPA_BUCKET`: production S3 bucket for the app bundle
- `BINDERSNAP_CLOUDFRONT_DISTRIBUTION_ID`: CloudFront distribution fronting `app.bindersnap.com`

Optional variables:

- `AWS_REGION`: defaults to `us-east-1`
- `BINDERSNAP_DEPLOY_TARGET_TAG_KEY`: defaults to `Project`
- `BINDERSNAP_DEPLOY_TARGET_TAG_VALUE`: defaults to `bindersnap`

Do not add a GitHub Environment to the deploy job unless you also change the IAM trust policy. GitHub switches the OIDC `sub` claim from a branch form to an environment form when an environment is attached.

## EC2 Prerequisites

The target instance must already satisfy these conditions:

- It is managed by AWS Systems Manager.
- It matches the deploy target tag used by the workflow.
- `/opt/bindersnap` contains the checked-out repo and `docker-compose.prod.yml`.
- `/opt/bindersnap/.env.prod` exists.
- The host can pull `ghcr.io/davidgraymi/bindersnap-api`.

The SSM command uses the same production compose contract documented in [`../../README.md`](../../README.md) and established by [`../../infra/compute/user-data.sh`](../../infra/compute/user-data.sh).

## Rollback

The rollback path is a manual rerun of the deploy workflow:

1. Open the `Deploy Production` workflow in GitHub Actions.
2. Choose `Run workflow`.
3. Set `api_tag` to a previously published commit SHA.
4. Run the workflow.

That rerun updates `API_TAG` in `/opt/bindersnap/.env.prod`, pulls the older image, and restarts only the API service.

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

- A push to `main` completes in under five minutes.
- A forced test failure prevents the `deploy` job from running.
- The workflow log prints SSM stdout and stderr from the remote deploy command.
- A visible SPA change is live at `https://app.bindersnap.com` after the workflow completes.
- A manual `api_tag` rollback returns the API to the selected SHA.
