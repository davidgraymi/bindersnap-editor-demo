# Cutover Runbook: `services/api` → Lambda + Aurora

Tracks issue [#224](https://github.com/davidgraymi/bindersnap-editor-demo/issues/224).

This runbook is the **operator-side** counterpart to the infra that has landed in `infra/api-service/`, the deploy pipeline in `.github/workflows/deploy-api.yml`, and the migration tooling in `services/api/db/migrate/` and `scripts/migrate-sqlite-to-postgres.ts`. Follow it once — at cutover — to flip production traffic from the host-side compose API onto the Lambda. Decommission of the host-side container is a separate runbook (linked at the bottom).

Estimated wall-clock: **45–90 minutes**, dominated by the live SQLite → Postgres copy and the Playwright verification pass.

## Preconditions

All of these must be true before you start. If any are false, stop and fix them — they are individually low-risk, but cutover is not the time to discover them.

- [ ] PR #257 (Gitea-as-NAT) merged and `terraform apply` run for both `infra/compute` (with `lambda_subnet_cidrs` populated) and `infra/api-service` (with `lambda_route_table_ids` populated).
- [ ] PR #258 (deploy-api.yml) merged. At least one successful run of `Deploy API Lambda` against `main` is visible in the Actions tab — i.e., the Lambda is already serving a real image, not the bootstrap `public.ecr.aws/lambda/provided:al2023` placeholder.
- [ ] `aws lambda invoke … /healthz` returns `statusCode: 200` when run locally with the same OIDC role (this is the same check `deploy-api.yml` runs; here we're re-running it manually to confirm the post-deploy check passes against the steady-state image).
- [ ] Aurora cluster reachable from the Lambda — confirm by tailing `/aws/lambda/bindersnap-prod-api` while invoking once; you should see a successful `BINDERSNAP_PG_HOST` connect log, **not** a VPC ENI timeout.
- [ ] You have console + CLI access to AWS as an operator role that can run `aws ssm start-session` against the Gitea host.
- [ ] You have `bun` ≥ 1.3 installed locally.

## Variables used below

```bash
export AWS_REGION=us-east-1
export PROD_INSTANCE_TAG="Project=bindersnap"
export AURORA_SECRET_ARN="$(terraform -chdir=infra/api-service output -raw aurora_master_secret_arn)"
export AURORA_HOST="$(terraform -chdir=infra/api-service output -raw aurora_endpoint)"
export AURORA_DB="$(terraform -chdir=infra/api-service output -raw aurora_database_name)"
export TOKEN_ENC_KEY="$(aws secretsmanager get-secret-value \
  --secret-id "$(terraform -chdir=infra/api-service output -raw token_encryption_key_secret_arn)" \
  --query SecretString --output text)"
export SQLITE_LOCAL="$HOME/cutover/sessions.db"
```

`BINDERSNAP_DATABASE_URL` is assembled from the Aurora outputs above plus the password resolved from `$AURORA_SECRET_ARN`:

```bash
export AURORA_PASSWORD="$(aws secretsmanager get-secret-value \
  --secret-id "$AURORA_SECRET_ARN" --query SecretString --output text | jq -r .password)"
export BINDERSNAP_DATABASE_URL="postgres://bindersnap_admin:${AURORA_PASSWORD}@${AURORA_HOST}:5432/${AURORA_DB}"
```

The password is in your shell history if you `echo` it. Don't.

## Step 1 — Bring Postgres schema to `EXPECTED_SCHEMA_VERSION`

The migration runner is **out-of-process**: it does not run when the Lambda boots. You apply it explicitly here. The current expected version is in `services/api/db/version.ts` (`EXPECTED_SCHEMA_VERSION`).

```bash
bun run scripts/check-database-url.ts        # sanity-check the URL you just exported
bun run --filter services/api db:migrate     # applies services/api/db/migrations/*.sql
```

Verify the `schema_versions` table reports the same string you expect:

```bash
psql "$BINDERSNAP_DATABASE_URL" -c "select version from schema_versions order by applied_at desc limit 1;"
```

If this string ≠ `EXPECTED_SCHEMA_VERSION` from `version.ts`, **stop**. The Lambda's startup probe will refuse to serve once `BINDERSNAP_DB_BACKEND=postgres` is set, so flipping the flag with a stale schema causes a clean abort rather than data corruption — but you'd be cutting traffic over to a no-op.

## Step 2 — Snapshot the host SQLite store

Pull a fresh copy of `/var/lib/bindersnap/sessions.db` off the Gitea host. The compose stack writes to it continuously, so we use Litestream's read-consistent path: copy via SSM Session Manager with the container quiesced for ≤30s.

```bash
INSTANCE_ID="$(aws ec2 describe-instances \
  --filters "Name=tag:${PROD_INSTANCE_TAG%%=*},Values=${PROD_INSTANCE_TAG#*=}" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"

aws ssm start-session --target "$INSTANCE_ID" --document-name AWS-StartNonInteractiveCommand \
  --parameters command="sudo docker compose -f /opt/bindersnap/docker-compose.prod.yml stop api && \
                        sudo sqlite3 /var/lib/docker/volumes/bindersnap-prod_api-data/_data/sessions.db \
                          \"VACUUM INTO '/tmp/sessions.db.snapshot';\" && \
                        sudo chown ssm-user:ssm-user /tmp/sessions.db.snapshot && \
                        sudo docker compose -f /opt/bindersnap/docker-compose.prod.yml start api"

# Pull it locally — adjust the bucket if your incident-scratch bucket is named differently.
aws ssm start-session --target "$INSTANCE_ID" --document-name AWS-StartNonInteractiveCommand \
  --parameters command="aws s3 cp /tmp/sessions.db.snapshot s3://bindersnap-incident-scratch/cutover/sessions.db"
mkdir -p "$(dirname "$SQLITE_LOCAL")"
aws s3 cp s3://bindersnap-incident-scratch/cutover/sessions.db "$SQLITE_LOCAL"
```

The stop/snapshot/start cycle takes ~10 seconds; in-flight sessions either retry (browser refresh handles `/auth/me`) or the user re-logs. We accept this micro-blip rather than running the copy against a live writer.

## Step 3 — Dry-run the SQLite → Postgres copy

```bash
bun run scripts/migrate-sqlite-to-postgres.ts \
  --sqlite-path "$SQLITE_LOCAL" \
  --database-url "$BINDERSNAP_DATABASE_URL" \
  --token-encryption-key "$TOKEN_ENC_KEY" \
  --dry-run
```

Expected output: one section per table (`sessions`, `subscriptions`, `subscription_access_overrides`, `processed_webhook_events`, `webhook_customer_state`) reporting `would write N rows` and `0 errors`. If any table reports errors, fix them before the real run — the most common is a row whose `expires_at` is in the past (expected for sessions; the script filters them) or whose Gitea token fails to decrypt under the current `TOKEN_ENC_KEY`.

## Step 4 — Real SQLite → Postgres copy

The destination must be empty. The script refuses to overwrite by default (`--allow-non-empty` exists but should not be needed for the first cutover).

```bash
bun run scripts/migrate-sqlite-to-postgres.ts \
  --sqlite-path "$SQLITE_LOCAL" \
  --database-url "$BINDERSNAP_DATABASE_URL" \
  --token-encryption-key "$TOKEN_ENC_KEY"
```

Expected exit status `0`. Spot-check three rows of each table:

```bash
psql "$BINDERSNAP_DATABASE_URL" <<'SQL'
select count(*) as sessions from sessions;
select count(*) as subscriptions from subscriptions;
select count(*) as overrides from subscription_access_overrides;
select count(*) as webhook_events from processed_webhook_events;
select count(*) as webhook_state from webhook_customer_state;
SQL
```

Counts should match the dry-run plan from Step 3 (minus expired sessions, which the script drops).

## Step 5 — Flip `BINDERSNAP_DB_BACKEND` on the Lambda

The Lambda's environment already has `BINDERSNAP_DB_BACKEND=postgres` set by Terraform — but the **host-side compose API is still running** and still authoritative for traffic, because the SPA's `VITE_API_BASE_URL` still points at the same-origin `/api`. We flip the SPA in Step 6. First, prove the Lambda is healthy under the freshly-loaded data:

```bash
# Same synthetic event the deploy workflow uses for /healthz.
aws lambda invoke --function-name bindersnap-prod-api \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload "$(printf '{"version":"2.0","routeKey":"GET /healthz","rawPath":"/healthz","rawQueryString":"","headers":{"accept":"*/*"},"requestContext":{"http":{"method":"GET","path":"/healthz","protocol":"HTTP/1.1","sourceIp":"127.0.0.1","userAgent":"cutover"},"stage":"$default","requestId":"cutover"},"isBase64Encoded":false}' | base64 -w0)" \
  /tmp/healthz.json
jq . /tmp/healthz.json
```

Then run a richer probe that exercises the Postgres path end-to-end:

```bash
# Replace SESSION_COOKIE_VALUE with a known-good session id from the migrated set.
SESSION_COOKIE_VALUE="$(psql "$BINDERSNAP_DATABASE_URL" -At -c \
  "select session_id from sessions where expires_at > extract(epoch from now()) order by created_at desc limit 1;")"

curl -fsS "https://api.bindersnap.com/auth/me" \
  -H "Cookie: bindersnap_session=${SESSION_COOKIE_VALUE}" \
  | jq .
```

A `200` with the expected `user_id` proves: API Gateway → Lambda → Aurora → Gitea (via the NAT) is wired correctly.

## Step 6 — Point the SPA at the new API origin

The SPA reads `BUN_PUBLIC_API_BASE_URL` at build time (see `.github/workflows/pages.yml`). It is already set to `https://api.bindersnap.com` in `pages.yml`, which resolves to the API Gateway HTTP API in the new architecture. Confirm the DNS record:

```bash
dig +short api.bindersnap.com CNAME
# Expect the API Gateway regional domain, not the EC2 EIP.
```

If it still points at the EC2 EIP via Caddy's `/api/*` proxy, update the Route 53 record (or your DNS provider) to the regional API Gateway domain name from `terraform -chdir=infra/api-service output -raw apigw_regional_domain_name`. Allow ≤5 minutes for propagation. Cache invalidation isn't needed — the SPA bundle URL doesn't change.

## Step 7 — Playwright verification

Run the integration suite from a developer workstation, targeting **production**. The suite is already parameterised on `PLAYWRIGHT_BASE_URL`:

```bash
PLAYWRIGHT_BASE_URL=https://bindersnap.com \
  bun run test:integration --grep "login|workspace|logout"
```

All three of `login`, `workspace home loads`, and `logout` must pass. If any fail, abort the cutover (Step 8 rollback) — these are the same flows the issue's acceptance criteria call out by name.

## Step 8 — Rollback (only if Steps 5–7 failed)

The host-side API container is still running and still has the SQLite store. To revert, point DNS back at the EIP and disable the SPA's call to API Gateway — both reversible in minutes:

```bash
# 1. Re-point api.bindersnap.com → EC2 EIP (Route 53 console or `aws route53 change-resource-record-sets`).
# 2. No code change needed — the host-side compose API kept serving the whole time.
```

The Postgres data is harmless: we copied **from** SQLite, never wrote back. Next attempt: re-snapshot SQLite (Step 2) and re-run from Step 3 — Postgres will refuse the second copy unless you `TRUNCATE` first or pass `--allow-non-empty`.

## Step 9 — Mark the cutover complete

- [ ] Comment on issue #224 with the cutover timestamp and the row counts from Step 4.
- [ ] Open the **decommission** runbook (see `docs/ops/decommission-host-api.md`, landing in PR #259 / part 4) — after a ~1-week soak.

---

## See also

- `services/api/db/migrate/run.ts` — the migration runner this runbook invokes via `bun run --filter services/api db:migrate`.
- `scripts/migrate-sqlite-to-postgres.ts` — the one-shot copy this runbook uses in Steps 3–4.
- `infra/api-service/README.md` — Terraform layout and outputs referenced by the variable exports at the top of this doc.
- Issue [#224 comments](https://github.com/davidgraymi/bindersnap-editor-demo/issues/224) — the architecture rationale (Fargate → Aurora+DynamoDB → Lambda+Aurora).
