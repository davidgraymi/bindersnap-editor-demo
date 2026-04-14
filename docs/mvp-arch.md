# Bindersnap MVP Infrastructure Plan

**Goal:** 1-click deployable, minimal ops, ~$15–20/mo. Sized for 10 customers at launch, 100 within 3 months. Architecture accommodates 10× that without re-architecture.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Pages         CloudFront ──► S3 (SPA)                   │
│  bindersnap.com       app.bindersnap.com                        │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  EC2 t4g.small (ARM, ~$12/mo on-demand, ~$7 reserved)           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Caddy (auto TLS)                                         │  │
│  │    └─► api.bindersnap.com ──► bun-api:8787                │  │
│  │                                                           │  │
│  │  Docker Compose network (internal)                        │  │
│  │    ├── bun-api        (from GHCR image)                   │  │
│  │    ├── gitea          (NOT publicly exposed)              │  │
│  │    └── litestream     (SQLite → S3 continuous replication)│  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  EBS gp3 20GB  ─► DLM daily snapshots (7-day retention)         │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  S3 (backups)      SSM Parameter Store    CloudWatch            │
│  litestream        (secrets loaded on     (uptime alarm ─► SNS) │
│  targets           boot via cloud-init)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sizing Rationale

At 100 customers (assume ~5 users/customer = ~500 total users, maybe 50 concurrent at peak):

- **Writes:** 500 users × 5 docs/day × ~3 writes/doc = 7,500/day = **~0.1 writes/sec**. SQLite doesn't notice.
- **Reads:** dominated by dashboard/list endpoints, trivially cacheable, <10 req/sec peak.
- **RAM:** Gitea idles at ~200MB, peaks ~400MB under load. Bun API ~100MB. Caddy ~20MB. Comfortable in 2GB.

`t4g.small` (2 vCPU, 2GB RAM, ARM) is the right box. You could technically run on `t4g.micro` (1GB) at launch but Gitea gets tight under burst load — the $5/mo savings isn't worth the debugging time.

---

## The "1-Click Deploy" Pipeline

Two independently triggered automated paths.

### Path A: Infrastructure (`terraform apply`)

Provisions everything. Idempotent. ~3 min from cold.

Modules:

- `dns/` — Route53 hosted zone + records for `bindersnap.com`, `app.`, `api.`
- `certs/` — ACM cert in us-east-1 for CloudFront
- `spa/` — S3 bucket + CloudFront distribution + origin access control
- `compute/` — EC2 instance + EBS volume + elastic IP + security group + IAM role
- `secrets/` — SSM parameters for `GITEA_ADMIN_PASS`, `GITEA_SECRET_KEY`, etc.
- `backups/` — DLM policy for EBS snapshots + S3 bucket for litestream
- `monitoring/` — CloudWatch alarm on instance status + SNS topic → email

~300 lines of HCL total.

### Path B: Application (GitHub Actions on push to main)

1. Run tests (`bun test`)
2. Build API Docker image, tag with commit SHA
3. Push to GHCR
4. Build SPA → `aws s3 sync` → invalidate CloudFront
5. Trigger EC2 deploy via **SSM SendCommand** (no SSH, no open ports):
   ```
   docker compose pull && docker compose up -d
   ```

Deploy time: ~90 seconds. Zero downtime for the SPA. ~5 second blip for the API.

---

## Concrete Changes from Current State

Each task below is self-contained and can be picked up by a subagent without prior context. Every task lists: objective, files, approach, and acceptance criteria.

---

### Task 1 — Persistent sessions via SQLite (~2h)

**Objective:** API restarts must not log users out.

**Files:**

- `services/api/server.ts` — replace session `Map` usage
- `services/api/sessions.ts` — new module
- `docker-compose.prod.yml` — mount `api-data` volume on the api service

**Approach:**

1. Create `services/api/sessions.ts` wrapping `bun:sqlite` (built-in, no new dep). Schema:
   ```sql
   CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     gitea_token TEXT NOT NULL,
     gitea_token_id INTEGER,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
   ```
2. Enable WAL mode on open: `db.exec("PRAGMA journal_mode=WAL")`. Required for Task 2 (Litestream).
3. Expose `SessionStore` interface: `get(id)`, `put(session)`, `delete(id)`, `reap(now)`.
4. Replace the in-memory `Map` calls in `server.ts`. The existing 60s GC interval should now call `reap()`.
5. Add env var `BINDERSNAP_SESSIONS_DB_PATH`, default `/var/lib/bindersnap/sessions.db`.
6. In `docker-compose.prod.yml`, add volume `api-data:/var/lib/bindersnap` to the `api` service and declare it at the bottom alongside `gitea-data`.

**Acceptance:**

- [ ] `docker compose restart api` does not invalidate existing sessions (integration test)
- [ ] Expired sessions purged on 60s interval
- [ ] Unit test for `SessionStore` covering insert, retrieve, expire, delete
- [ ] Explicit logout still revokes the underlying Gitea token
- [ ] No `Map`-based session storage remains in `server.ts`

---

### Task 2 — Litestream continuous replication (~1h)

**Objective:** Near-zero RPO for Gitea and API SQLite files via continuous replication to S3.

**Prerequisites:** Task 1 complete (api sessions.db exists); S3 bucket provisioned (can be in same Terraform module as Task 3).

**Files:**

- `litestream.yml` (new, repo root)
- `docker-compose.prod.yml` — new `litestream` service
- `infra/backups/main.tf` — S3 bucket + IAM policy
- `scripts/restore.sh` (new) — documented restore procedure

**Approach:**

1. Provision S3 bucket `bindersnap-litestream-{account-id}` with: versioning enabled, lifecycle rule expiring noncurrent versions after 30 days, public access blocked.
2. Attach IAM policy to the EC2 instance profile granting `s3:PutObject|GetObject|ListBucket|DeleteObject` on that bucket.
3. `litestream.yml`:
   ```yaml
   dbs:
     - path: /data/gitea/gitea.db
       replicas:
         - type: s3
           bucket: bindersnap-litestream-{account-id}
           path: gitea
     - path: /data/api/sessions.db
       replicas:
         - type: s3
           bucket: bindersnap-litestream-{account-id}
           path: api
   ```
4. Add `litestream` service to prod compose using `litestream/litestream:0.3` image. Mount `gitea-data:/data/gitea` and `api-data:/data/api`. Command: `replicate`. Uses IMDSv2 credentials from the instance profile (no keys in env).
5. `scripts/restore.sh` — takes `gitea|api` arg and runs `litestream restore -o <target> s3://...`.

**Acceptance:**

- [ ] `docker compose logs litestream` shows successful periodic sync with no errors for 24h
- [ ] Replication lag < 1s under normal load (check `litestream replicas` output)
- [ ] Restore drill: delete local DB, run `scripts/restore.sh gitea`, bring Gitea up, verify data intact
- [ ] README documents the restore procedure

**Gotchas:**

- Litestream _requires_ WAL mode. Gitea 1.25 defaults to WAL. API must explicitly enable it (Task 1 step 2).
- Do not run `VACUUM` on a replicated DB without pausing replication first.

---

### Task 3 — DLM daily EBS snapshots (~15m)

**Objective:** Full-volume recovery target for disaster scenarios.

**Prerequisites:** EBS volume exists in Terraform state.

**Files:**

- `infra/backups/dlm.tf` (new)

**Approach:**

1. Tag the `gitea-data` EBS volume with `Backup=daily` in its Terraform resource.
2. Create the default IAM role: `aws_iam_service_linked_role` for DLM, or create manually if needed.
3. Terraform `aws_dlm_lifecycle_policy`:
   - Target tags: `{ Backup = "daily" }`
   - Schedule: 24h interval starting at `03:00 UTC`
   - Retention: 7 snapshots
   - Copy tags: enabled
   - Fast snapshot restore: disabled (cost)
4. `terraform apply`, verify policy status is `ENABLED` in console.

**Acceptance:**

- [ ] `aws ec2 describe-snapshots --filters Name=volume-id,Values=<vol-id>` returns a new snapshot within 24h of first apply
- [ ] After 8 days, exactly 7 snapshots exist (oldest auto-deleted)
- [ ] Policy tagged `Project=bindersnap`

---

### Task 4 — Lock down Gitea endpoint (~5m)

**Objective:** Gitea accessible only on the internal Docker network.

**Prerequisites:** Verify API reaches Gitea via `http://gitea:3000` (already true per `docker-compose.prod.yml`).

**Files:**

- `Caddyfile.prod` — delete the `gitea.bindersnap.com { ... }` block
- `docs/ops/gitea-access.md` (new) — document operator tunnel procedure
- Route53 — optionally remove `gitea.bindersnap.com` A record

**Approach:**

1. Delete the Gitea block from `Caddyfile.prod` (lines 14–26).
2. `docker compose -f docker-compose.prod.yml up -d caddy` to reload.
3. Document the SSH tunnel for operator access: `ssh -L 3000:gitea:3000 ec2-user@<instance>`. Gitea UI then available at `http://localhost:3000`.
4. Optionally delete the Route53 record if no dependency exists.

**Acceptance:**

- [ ] `curl -I https://gitea.bindersnap.com` fails (TLS error or connection refused)
- [ ] End-to-end app flow passes: login, create doc, upload file, review, merge
- [ ] Tunnel procedure reproduced end-to-end and documented

---

### Task 5 — CloudFront in front of S3 SPA (~30m)

**Objective:** Edge TLS, caching, SPA-aware error routing.

**Prerequisites:** ACM cert for `app.bindersnap.com` in `us-east-1` (CloudFront requires).

**Files:**

- `infra/spa/main.tf` (new or extend existing)
- `.github/workflows/deploy.yml` — add invalidation step (finalized in Task 10)

**Approach:**

1. Terraform:
   - `aws_s3_bucket` `bindersnap-spa` with all public access blocked
   - `aws_cloudfront_origin_access_control` type `s3`, signing `sigv4`
   - `aws_cloudfront_distribution`:
     - Origin: the S3 bucket via OAC
     - Default root object: `index.html`
     - Viewer protocol policy: `redirect-to-https`
     - Custom error responses: map `403` and `404` → `/index.html` with 200 (SPA deep-link support)
     - Price class: `PriceClass_100`
     - Default cache behavior: Managed-CachingOptimized policy
     - Additional ordered cache behavior for `/index.html`: CachingDisabled
   - `aws_s3_bucket_policy` allowing the CloudFront OAC principal
   - `aws_route53_record` ALIAS `app.bindersnap.com` → CloudFront distribution
2. Post-deploy invalidation: `aws cloudfront create-invalidation --distribution-id $ID --paths /index.html` (wired in Task 10).

**Acceptance:**

- [ ] `curl -I https://app.bindersnap.com` returns `200` with CloudFront headers (`x-cache`, `x-amz-cf-id`)
- [ ] Direct S3 URL returns `403` (OAC-enforced)
- [ ] Deep link like `https://app.bindersnap.com/documents/anything` loads the SPA (not a 404)
- [ ] `index.html` is never cached at the edge; hashed assets cache for 1y

---

### Task 6 — Docker images in CI, stop mounting source (~2h)

**Objective:** Reproducible, rollback-able API deploys.

**Prerequisites:** GHCR access (Actions have it implicitly via `GITHUB_TOKEN` with `packages: write`).

**Files:**

- `services/api/Dockerfile` (new)
- `.github/workflows/build-api.yml` (new; may be merged into Task 10's deploy.yml)
- `docker-compose.prod.yml` — switch `api` service from `oven/bun:1` + source mount to GHCR image

**Approach:**

1. `services/api/Dockerfile` (multi-stage, non-root):

   ```dockerfile
   FROM oven/bun:1 AS builder
   WORKDIR /app
   COPY package.json bun.lock ./
   COPY packages ./packages
   COPY services/api ./services/api
   RUN bun install --frozen-lockfile --production

   FROM oven/bun:1-slim
   WORKDIR /app
   COPY --from=builder /app .
   USER bun
   EXPOSE 8787
   CMD ["bun", "services/api/server.ts"]
   ```

2. Workflow on push to `main`: log into GHCR → `docker buildx build --platform linux/arm64` (matches t4g.small) → tag `ghcr.io/{org}/bindersnap-api:{sha}` and `:latest` → push.
3. In `docker-compose.prod.yml`:
   - Remove `image: oven/bun:1`, `command:`, and `volumes: - .:/app:ro` from the `api` service
   - Replace with `image: ghcr.io/{org}/bindersnap-api:${API_TAG:-latest}`
4. Ensure the EC2 instance can pull from GHCR (public image OR private pull with PAT in SSM).

**Acceptance:**

- [ ] `docker pull ghcr.io/{org}/bindersnap-api:{sha}` succeeds for arm64 manifest
- [ ] Prod server has no repository source on disk (verify `/app` only contains container-built artifacts)
- [ ] Rollback verified: set `API_TAG=<previous-sha>`, `docker compose up -d api`, previous version runs
- [ ] Image size < 300MB

**Gotchas:**

- Build on ARM runner (`runs-on: ubuntu-24.04-arm`) to avoid QEMU and halve build time.

---

### Task 7 — Secrets in SSM Parameter Store (~1h)

**Objective:** No secret values on disk in the repo or the EC2 instance until boot-time fetch.

**Prerequisites:** EC2 instance profile exists.

**Files:**

- `infra/secrets/main.tf` (new)
- `infra/compute/user-data.sh` (new or extend) — cloud-init
- `.env.prod.example` — document the schema

**Approach:**

1. Terraform `aws_ssm_parameter` resources (type `SecureString`) for each secret. Suggested path prefix `/bindersnap/prod/`:
   - `gitea_admin_user`, `gitea_admin_pass`
   - `gitea_secret_key`, `gitea_internal_token`
   - `bindersnap_user_email_domain`
   - (any other variable from `docker-compose.prod.yml` that isn't safe to commit)
2. Attach IAM policy to the instance profile: `ssm:GetParametersByPath` + `kms:Decrypt` scoped to `/bindersnap/prod/*` only.
3. cloud-init script (runs on boot, systemd one-shot):
   ```bash
   aws ssm get-parameters-by-path \
     --path /bindersnap/prod/ --with-decryption \
     --query 'Parameters[*].[Name,Value]' --output text \
     | awk '{name=$1; sub(".*/", "", name); gsub("-", "_", name); print toupper(name)"="$2}' \
     > /opt/bindersnap/.env.prod
   chmod 600 /opt/bindersnap/.env.prod
   chown root:root /opt/bindersnap/.env.prod
   ```
4. `docker compose --env-file /opt/bindersnap/.env.prod -f docker-compose.prod.yml up -d`.
5. `.env.prod` is `.gitignore`d — only `.env.prod.example` committed.

**Acceptance:**

- [ ] `cat /opt/bindersnap/.env.prod` on the instance matches SSM values
- [ ] `grep -r "GITEA_SECRET_KEY=" .` in the repo returns only `.env.prod.example` with placeholder
- [ ] Rotation test: update an SSM parameter → re-run cloud-init → restart compose → new value in effect
- [ ] IAM policy scoped to path prefix, not `*`

---

### Task 8 — Dedicated Gitea service account (~30m)

**Objective:** API runs with least-privilege, not Gitea admin credentials.

**Prerequisites:** Tasks 1 and 7 complete.

**Files:**

- `services/api/server.ts` — auth/client instantiation
- `scripts/bootstrap-gitea-service-account.ts` (new, one-time)
- `infra/secrets/main.tf` — add `gitea_service_token` parameter

**Approach:**

1. Audit `services/api/server.ts` for every call that currently uses admin credentials. Document the list (likely: user creation, user token creation, user token revocation).
2. Gitea personal access tokens support scopes. Determine the minimum set — likely `write:admin` is unavoidable for user creation, but `write:user`, `write:repository` are NOT needed on the service token (per-user tokens cover those).
3. Bootstrap script: create Gitea user `bindersnap-service`, grant sysadmin, generate a PAT with minimum scopes, write to SSM under `/bindersnap/prod/gitea_service_token`. Run manually once, post-deploy.
4. Replace admin-credential calls in the API with the service token.
5. Rotate the admin password to a value stored only in 1Password (break-glass); remove admin creds from SSM.

**Acceptance:**

- [ ] `grep GITEA_ADMIN_PASS services/api/` returns no runtime usage (only read into env, not used for Gitea calls)
- [ ] Service token has strictly fewer scopes than admin
- [ ] Signup → login → create doc → review → merge passes end-to-end
- [ ] Admin password recorded in 1Password and removed from SSM

**Notes:**

- Gitea's scope model is coarse; aim for least-privilege but accept `write:admin` may still be required.

---

### Task 9 — Uptime alarm (~15m)

**Objective:** Notify within 2 min of instance going down.

**Files:**

- `infra/monitoring/main.tf` (new)

**Approach:**

1. Terraform:
   - `aws_sns_topic` `bindersnap-alerts`
   - `aws_sns_topic_subscription` email → your address (requires manual confirm)
   - `aws_cloudwatch_metric_alarm` on `AWS/EC2 StatusCheckFailed`:
     - Instance-scoped (dimension: `InstanceId`)
     - Period 60s, eval periods 2, threshold `>= 1`
     - Alarm action: notify the SNS topic
   - Second alarm: `CPUUtilization > 90%` for 5 min (early warning)
2. (Optional, +~$4/mo) `aws_synthetics_canary` hitting `https://app.bindersnap.com` every 5 min for synthetic uptime checks.

**Acceptance:**

- [ ] Email subscription confirmed (`aws sns list-subscriptions` shows `PendingConfirmation: false`)
- [ ] Manual test: stop the instance → alert received within 2 min
- [ ] Start instance → alarm clears automatically

---

### Task 10 — GitHub Actions deploy pipeline (~3h)

**Objective:** `git push origin main` deploys SPA and API end-to-end.

**Prerequisites:** Tasks 5, 6, 7, 9 complete.

**Files:**

- `.github/workflows/deploy.yml` (new)
- `infra/ci/oidc.tf` (new) — IAM role trusting GitHub OIDC

**Approach:**

1. Terraform: GitHub OIDC provider + `aws_iam_role` `bindersnap-deploy` trusted by `token.actions.githubusercontent.com`, scoped via `sub` claim to `repo:{org}/bindersnap-editor-demo:ref:refs/heads/main`. Permissions: `s3:*` on SPA bucket, `cloudfront:CreateInvalidation` on the distribution, `ssm:SendCommand` on instances tagged `Project=bindersnap`.
2. Workflow stages:
   - `test` — `bun install` + `bun test`
   - `build-api` — builds and pushes GHCR image tagged with commit SHA (from Task 6)
   - `build-spa` — `bun run build:app` → artifact
   - `deploy` (needs all above):
     - `aws-actions/configure-aws-credentials` via OIDC (no long-lived keys)
     - `aws s3 sync ./dist/app s3://bindersnap-spa/ --delete`
     - `aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /index.html`
     - `aws ssm send-command --targets Key=tag:Project,Values=bindersnap --document-name AWS-RunShellScript --parameters 'commands=["cd /opt/bindersnap && API_TAG=${{ github.sha }} docker compose pull api && docker compose up -d api"]'`
     - Poll `aws ssm list-command-invocations` until `Status=Success` or fail the job
3. Document manual rollback: re-run the `deploy` job with `API_TAG` env override set to a prior SHA.

**Acceptance:**

- [ ] Push to main triggers the pipeline; full deploy completes in under 5 min
- [ ] Failing `bun test` blocks deploy
- [ ] SSM command output captured in workflow logs
- [ ] End-to-end: make a visible change, push, observe it live at `https://app.bindersnap.com` within 5 min
- [ ] Rollback procedure reproduced and documented in `docs/ops/deploy.md`

---

**Total: ~1.5 engineer-days.**

---

## Cost Breakdown

At launch (10 customers):

| Item                                  | Monthly     |
| ------------------------------------- | ----------- |
| EC2 t4g.small on-demand               | $12         |
| EBS gp3 20GB                          | $1.60       |
| EBS snapshots (~20GB incremental × 7) | ~$0.70      |
| S3 (SPA + Litestream backups, <2GB)   | <$0.25      |
| CloudFront (negligible traffic)       | <$0.50      |
| Route53 hosted zone                   | $0.50       |
| Data transfer out                     | <$0.50      |
| SSM, CloudWatch, SNS (free tier)      | $0          |
| **Total**                             | **~$16/mo** |

At 100 customers (3 months in):

- Same resources hold; incremental cost is mostly CloudFront egress and marginal data transfer.
- **Total: ~$18–20/mo**

Reserve the EC2 for 1 year once stable → drops to ~$12/mo.

---

## Scaling Path

You don't need to re-architect. Each step is isolated and triggered by actual pain, not hypothetical future load:

1. **Memory or CPU pressure:** vertical scale `t4g.small` → `medium` → `large`. One Terraform variable, 30-second reboot.
2. **API becomes bottleneck (unlikely pre-~5k users):** extract API to its own instance behind an ALB.
3. **SQLite concurrency becomes bottleneck (very unlikely pre-~5k users):** migrate Gitea to Postgres on RDS.
4. **Multi-region / uptime SLAs matter:** this is when ADR 0002 earns its complexity.

None of these are forced by 100 customers. Probably none forced by 1,000.

---

## What I'd NOT Recommend

- **ECS Fargate / EKS** — overkill at this scale.
- **RDS / Aurora from day one** — +$25–45/mo for zero functional win. SQLite handles your write volume trivially.
- **Serverless API (Lambda)** — you can't eliminate the EC2 box (Gitea is stateful), so Lambda adds cost instead of removing it.
- **Multi-AZ / load balancer** — ALB alone is $18/mo for failover coverage you can live without at MVP.

---

## Alternative Worth 2 Hours of Evaluation: Fly.io

Fits your minimalism constraint even better than EC2 + Terraform:

- 2 `fly.toml` files (api, gitea), `fly deploy` replaces the CI → SSM → docker compose pipeline
- Built-in TLS, volumes, secrets management
- ~$10–15/mo at this scale
- Clean metrics + logs dashboard out of the box

**Trade-off:** platform lock-in, less direct AWS integration. If you haven't committed to AWS ops tooling, genuinely worth evaluating before you write the Terraform.

---

## Suggested Execution Order

**Week 1 (critical safety net):**

1. DLM snapshots (#3)
2. Sessions to SQLite (#1)
3. Remove public Gitea endpoint (#4)

**Week 2 (reproducibility):** 4. Terraform-ify existing AWS resources (#7, #9) 5. Build Docker images in CI (#6) 6. Deploy via SSM SendCommand (#10)

**Week 3 (polish):** 7. Litestream (#2) 8. CloudFront (#5) 9. Dedicated Gitea service account (#8)

After week 3, you can rebuild the entire stack from scratch in 15 minutes with one command. That's the bar for MVP infrastructure that won't bite you.
