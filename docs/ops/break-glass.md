# Break-glass: recover a failed production deploy

Use this when `deploy-pyinfra.yml` fails, hangs, or ships a bad change and you
need to recover the production host **without** the CI pipeline.

**Principle:** the recovery path must not depend on GitHub Actions. You connect
to the host directly over AWS Systems Manager using your **own operator AWS
credentials** (admin/elevated), not the CI OIDC role. No inbound port 22, no SSH
key, no pipeline.

## 0. Prerequisites

- AWS credentials with `ssm:StartSession` (your normal admin/operator identity).
- Either the AWS CLI + `session-manager-plugin` locally, **or** the AWS Console
  (Systems Manager → Session Manager → Start session).
- Handy values:
  - Instance tag: `Project=bindersnap`
  - App dir on host: `/opt/bindersnap`
  - Compose file: `docker-compose.prod.yml`, env file: `.env.prod`
  - SSM config path: `/bindersnap/prod`, KMS alias: `alias/bindersnap-prod-ssm`

## 1. Get a shell on the host (no pipeline, no SSH key)

This uses the plain SSM shell session document — independent of the deploy's
`AWS-StartSSHSession` tunnel.

```bash
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=bindersnap" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].InstanceId | [0]' --output text)

aws ssm start-session --target "$INSTANCE_ID"
# then, on the host:
sudo -i
cd /opt/bindersnap
```

Console fallback: **Systems Manager → Session Manager → Start session →** pick the
`bindersnap` instance.

## 2. Assess

```bash
cd /opt/bindersnap
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail=100 api
docker image ls ghcr.io/davidgraymi/bindersnap-api   # what image is on disk
grep -E '^API_TAG=' .env.prod || echo "API_TAG unset -> running :latest"
```

## 3. Roll back the API image to a known-good build (fastest)

Every past build is published as an immutable `ghcr.io/davidgraymi/bindersnap-api:<sha>`
tag by `build-api.yml`. Pick the last-good commit SHA and pin it on the host:

```bash
cd /opt/bindersnap
GOOD_SHA=<previous-good-commit-sha>

# set (or replace) the API_TAG line in the env file
if grep -q '^API_TAG=' .env.prod; then
  sed -i "s/^API_TAG=.*/API_TAG=${GOOD_SHA}/" .env.prod
else
  printf 'API_TAG=%s\n' "${GOOD_SHA}" >> .env.prod
fi

docker compose --env-file .env.prod -f docker-compose.prod.yml pull api
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api
docker compose --env-file .env.prod -f docker-compose.prod.yml ps api
```

> **This edit is transient.** The next `deploy-pyinfra.yml` run re-renders
> `.env.prod` from SSM and drops the manual `API_TAG`. That is fine for stopping
> the bleeding — go to step 4 to make it survive, or fix forward and redeploy.

## 4. Make the rollback survive the next deploy

`.env.prod` is rendered from the SSM tree, and `env_render.py` emits an
`API_TAG` line for any `api_tag` leaf it finds. An SSM `api_tag` **overrides**
the per-deploy SHA pin, so it survives every subsequent push. Set one:

```bash
aws ssm put-parameter \
  --name /bindersnap/prod/api_tag \
  --type String \
  --overwrite \
  --value <previous-good-commit-sha>
```

Now every deploy pins that SHA until you change or delete the parameter. This is
"shadow" config (not tracked in `infra/secrets`) — for a permanent pin, add
`api_tag` to `infra/secrets/main.tf`; to un-pin, `aws ssm delete-parameter
--name /bindersnap/prod/api_tag` (reverts to the normal per-deploy pin: the
deployed commit's `:<sha>`).

> For a **one-off** rollback that does _not_ need to survive future pushes,
> prefer the normal deploy path instead of an SSM edit: run the
> `Deploy Production (pyinfra)` workflow with the `api_tag` input set to the
> last-good SHA (see `deploy/README.md` → "API image pinning & rollback").

## 5. Roll back the config / full stack definition

If the failure is in config (`docker-compose.prod.yml`, `Caddyfile.prod`, …) or
in `deploy.py`:

- **Preferred, if CI is healthy:** `git revert` the offending commit on `main`.
  The revert push re-runs `deploy-pyinfra.yml` and re-applies the known-good stack.
- **If the pipeline itself is broken:** run the deploy from your laptop against
  the last-good ref, using your operator AWS creds:

  ```bash
  git checkout <last-good-sha>
  uv venv deploy/.venv && uv pip install --python deploy/.venv -r deploy/requirements.txt
  PATH="$PWD/deploy/.venv/bin:$PATH" deploy/bin/ssm-connect.sh --dry   # preview
  PATH="$PWD/deploy/.venv/bin:$PATH" deploy/bin/ssm-connect.sh         # apply
  ```

  `deploy.py` is idempotent, so re-applying an older ref restores that ref's
  config, env render, and stack state.

## 6. Last resort: stop the bleeding

```bash
cd /opt/bindersnap
# reconcile the whole stack to the on-host config
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
# or restart a single service
docker compose --env-file .env.prod -f docker-compose.prod.yml restart api
# or take the app down entirely (maintenance)
docker compose --env-file .env.prod -f docker-compose.prod.yml down
```

## Notes and caveats

- **Secrets/env are owned by SSM.** Any manual `.env.prod` edit is overwritten on
  the next deploy — use step 4 (SSM) for anything that must persist.
- **`compose up` recreates only on change.** `deploy.py`'s stack-up force-recreates
  only when config or env changed this run; a manual `up -d api` after an
  `API_TAG` change (step 3) recreates the API because the env changed.
- **Data safety.** Gitea, SQLite sessions, and litestream data live on the EBS
  data volume mounted at `/data`; `compose down` (without `-v`) and image
  rollbacks do not touch it. Never pass `-v` to `compose down` in break-glass.
- **Concurrency.** A manual deploy and a CI deploy can collide. If you run
  `ssm-connect.sh` locally, make sure no `deploy-production` run is in flight in
  GitHub Actions first.
