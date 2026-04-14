# Task 7 Handoff

## What I changed

- Added `infra/secrets/main.tf` for the SSM Parameter Store implementation.
  - Creates `/bindersnap/prod/*` parameters for:
    - `gitea_admin_user`
    - `gitea_admin_pass`
    - `gitea_secret_key`
    - `gitea_internal_token`
    - `bindersnap_user_email_domain`
    - `litestream_s3_bucket`
  - Uses a dedicated KMS key and an attachable IAM policy for the EC2 instance
    role.
- Added `infra/compute/user-data.sh`.
  - Installs a `bindersnap-refresh-env` helper.
  - Creates `bindersnap-refresh-env.service` and `bindersnap-compose.service`.
  - Generates `/opt/bindersnap/.env.prod` from SSM on boot before
    `docker compose up -d`.
- Updated `.env.prod.example` to document the generated schema rather than a
  committed production env file workflow.
- Updated `docker-compose.prod.yml` comments and error text to point at
  `/opt/bindersnap/.env.prod`.
- Updated `README.md` to describe the SSM-backed production secret flow and the
  new env-file location used for deploy/restore commands.
- Added `scripts/ssm-parameter-store.test.ts` for static contract coverage.
- Added `scripts/bindersnap-refresh-env.test.ts` to execute the embedded refresh
  helper against fixture SSM output and verify regeneration/rotation behavior.

## What I validated

- `bash -n infra/compute/user-data.sh`
- `bun test scripts/ssm-parameter-store.test.ts`
- `bun test scripts/bindersnap-refresh-env.test.ts scripts/ssm-parameter-store.test.ts`
- `terraform -chdir=infra/secrets fmt -check`
- `terraform -chdir=infra/secrets init -backend=false`
- `terraform -chdir=infra/secrets validate`
- `docker compose -f docker-compose.prod.yml --env-file .env.prod.example config`
- A repo-wide hidden-file scan for the secret-key assignment pattern (excluding
  `.git` and `node_modules`)

## What is still left

- Run a real Terraform plan/apply in AWS and verify the generated resources and
  IAM policy on the actual EC2 instance role.
- Boot a real host with `infra/compute/user-data.sh` and confirm:
  - `/opt/bindersnap/.env.prod` matches SSM values.
  - `bindersnap-refresh-env.service` and `bindersnap-compose.service` succeed.
  - `docker compose` starts cleanly with the generated env file.
- Perform the rotation drill from the story:
  - update an SSM parameter
  - rerun the refresh service / cloud-init flow
  - restart compose
  - verify the new value is in effect
- Decide whether `litestream_s3_bucket` should stay in the same SSM path or move
  to a separate non-secret config path. I kept it here so the generated env file
  is sufficient for `docker-compose.prod.yml`.
- Reconcile this with Task 8 later when `gitea_service_token` gets introduced.
- The repo leak check is clean for the implementation files and tests now; the
  remaining secret-key assignment hit outside `.env.prod.example` is the
  acceptance checklist line in `docs/mvp-arch.md` itself.

## Known repo context

- There is an unrelated stale test in `services/api/docker-image.test.ts`; the
  full ops suite is not a reliable signal for Task 7 right now.
