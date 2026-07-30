# Decommission Runbook: Host-side `api` container

Tracks issue [#224](https://github.com/davidgraymi/bindersnap-editor-demo/issues/224).

Once the Lambda + Aurora cutover (`docs/ops/cutover-api-to-lambda.md`) has been live and **observed stable for ~1 week**, run through this runbook to delete the host-side `api` container and its supporting plumbing. The Gitea + Caddy + Litestream services remain; only the API tier moves off the box.

Estimated wall-clock: **20–30 minutes**, almost entirely waiting for the compose stack to reconcile.

## Pre-flight check (don't skip)

Even after a quiet soak, confirm zero traffic is hitting the host-side API before removing it:

```bash
# 1. CloudWatch Logs for the host-side container — should be silent.
aws logs tail /bindersnap/api --since 24h --follow=false | tail -50

# 2. Lambda invocation count for the same window — should be the *only* path serving prod.
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda --metric-name Invocations \
  --dimensions Name=FunctionName,Value=bindersnap-prod-api \
  --start-time "$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time   "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 3600 --statistics Sum
```

If `/bindersnap/api` has had **any** traffic in the last 24h, the SPA, the apex domain, or someone's bookmark is still hitting the old origin — fix that before continuing.

## Step 1 — Snapshot, just in case

Take a final SQLite snapshot and store it in the incident-scratch bucket as a 30-day fallback. After this point we're going to delete the volume.

```bash
INSTANCE_ID="$(aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=bindersnap" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"

aws ssm start-session --target "$INSTANCE_ID" \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters command="sudo sqlite3 /var/lib/docker/volumes/bindersnap-prod_api-data/_data/sessions.db \
                          \"VACUUM INTO '/tmp/sessions.db.final';\" && \
                        aws s3 cp /tmp/sessions.db.final s3://bindersnap-incident-scratch/decommission/sessions.db.$(date -u +%Y%m%d)"
```

## Step 2 — Edit `deploy/files/docker-compose.prod.yml`

Remove the `api` service definition and every reference to it.

Concretely, three edits in `deploy/files/docker-compose.prod.yml`:

1. Delete the entire `api:` service block (currently lines 72–105).
2. In `caddy.depends_on`, remove the `api: { condition: service_started }` entry. Caddy's `api.bindersnap.com` site block (see Step 3) is being removed; once that's gone, Caddy has no reason to wait on the API.
3. In `litestream.depends_on`, remove the `api: { condition: service_started }` entry.

The `api-data` named volume can stay defined for one more deploy cycle so the `docker compose down` in Step 5 cleans it up explicitly; remove it on the next commit after.

## Step 3 — Edit `deploy/files/Caddyfile.prod`

Delete the entire `api.bindersnap.com { … }` site block (currently lines 31–55, including the `rate_limit` zone and the `reverse_proxy api:8787` directive). `api.bindersnap.com` now resolves to API Gateway via DNS (see Step 6 of the cutover runbook) — Caddy doesn't need to know about it.

If `import security_headers` is only referenced by this block, leave the snippet defined; it remains used by the apex `bindersnap.com` block.

## Step 4 — Edit `deploy/files/litestream.yml`

Remove the `/data/api/sessions.db` entry. Postgres backups are handled by Aurora's automated snapshot + `infra/backups/`; Litestream no longer needs to replicate the SQLite file.

## Step 5 — Remove API plumbing from the host

The user-data and helper scripts on the host include an API-specific GHCR login (`/usr/local/bin/bindersnap-ghcr-login`) and a few API env keys propagated from SSM. Once the compose stack stops referencing the API image, these are dead weight.

Two edits in `infra/compute/user-data.sh.tftpl`:

1. Delete the `bindersnap-ghcr-login` script and its systemd unit. The unit is between the `# ---------- GHCR authentication (optional) ----------` banner and the `# ---------- Gitea service-token bootstrap ----------` banner. Gitea pulls from a public image, so nothing else on the host needs GHCR.
2. Remove `bindersnap-ghcr-login.service` from the `WantedBy=` chain of `bindersnap-compose.service` and from the `systemctl enable --now` block at the bottom of the file.

The API-specific SSM keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `BINDERSNAP_GITEA_SERVICE_TOKEN`, etc.) **stay in SSM** — the Lambda still consumes them. Only their delivery onto the host's `.env.prod` becomes dead code, but the refresh script is generic and doesn't need to be changed.

Commit and push these three edits in one PR. The config deploy workflow will sync `deploy/files/` to S3 and the periodic `bindersnap-refresh-and-restart.timer` will re-pull and reconcile compose within 6 hours — or trigger it immediately:

```bash
aws ssm send-command --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl start bindersnap-refresh-and-restart.service"]'
```

## Step 6 — Verify the API container is gone

After the timer (or your manual trigger) fires:

```bash
aws ssm start-session --target "$INSTANCE_ID" \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters command="sudo docker ps --filter name=bindersnap-api-prod --format '{{.Names}}' || true; \
                        sudo docker volume ls --filter name=api-data --format '{{.Name}}' || true"
```

Both commands should print nothing. If the volume is still present, the host had no reason to remove it (compose only removes orphan volumes on `down --volumes`). Remove it explicitly:

```bash
aws ssm start-session --target "$INSTANCE_ID" \
  --document-name AWS-StartNonInteractiveCommand \
  --parameters command="sudo docker volume rm bindersnap-prod_api-data"
```

## Step 7 — Tear down host-side log group

```bash
aws logs delete-log-group --log-group-name /bindersnap/api
```

The compose service was the only writer; with it gone the group is dead.

## Step 8 — Close the loop

- [ ] Comment on issue #224 with the decommission timestamp and link the PR that landed the edits in Steps 2–5.
- [ ] Re-run the Playwright login → workspace → logout flow once more to confirm nothing regressed during the host reconcile.
- [ ] Tick the issue's "API container is removed from `docker-compose.prod.yml` and from the EC2 host" acceptance criterion.

---

## See also

- `docs/ops/cutover-api-to-lambda.md` — the cutover this decommission follows.
- `infra/api-service/` — the new home for the API tier.
- `deploy/files/docker-compose.prod.yml`, `deploy/files/Caddyfile.prod`, `deploy/files/litestream.yml`, `infra/compute/user-data.sh.tftpl` — the four files this runbook edits.
