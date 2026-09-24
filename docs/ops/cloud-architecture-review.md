# Cloud architecture review: backups, weaknesses, and the target architecture

_Reviewed 2026-09-24 against `main` (`infra/`, `deploy/`, `docs/adr/0003`)._

## Verdict

**Yes, there is a hole in the backups, and it is in the most important data we
hold.**

Litestream continuously replicates the two SQLite databases (`gitea.db` and
the API's `sessions.db`). It does **not** touch the git repositories under
`/data/git/repositories`. Those repositories are the product: every document,
every version, every uploaded file. ADR 0001 and non-negotiable #2 in
`CLAUDE.md` make them the permanent record. Before this branch, the only copy
of them anywhere was:

- one EBS snapshot a day (`infra/backups/dlm.tf`, 03:00 UTC),
- kept for 7 days,
- in the same region and the same AWS account as production,
- taken by a DLM policy that runs as a role nothing in this repo creates, and
  that no alarm watches.

So in the best case we could lose up to 24 hours of customer documents. In the
worst case (the DLM role was never created, or the volume lost its tag) no
snapshots exist at all, and nobody would know until a restore.

The written DR plan misses this too. ADR 0003 says _"Disaster recovery is:
Terraform apply, push to `main`, restore from Litestream."_ Following it on a
fresh host gives you a current `gitea.db` that points at repositories that do
not exist.

**`deploy/` had a second, worse hole: it could overwrite the backup with an
empty database.** If `deploy.py` could not find the EBS data volume, it printed
a warning and carried on with Docker on the root disk. Gitea would start there
on a new, empty database. Litestream would replicate that empty database to S3
as a new generation, and `litestream restore` picks the newest generation. The
root disk is not snapshotted either, and is deleted when the instance is
replaced. The boot path had the same flaw, because the `/data` mount is `nofail`
and Docker was not ordered after it. Nothing needed to fail loudly for this to
happen: a push to `main` while the volume was detached (for example after an
instance replacement) was enough (C7).

This branch closes the part of the hole that Terraform and `deploy/` can close
without a live host (see [What this branch changes](#what-this-branch-changes)).
The rest is Phase 0 of the roadmap below.

---

## 1. Current state

```
                    Internet
                       │  :80 / :443 (0.0.0.0/0)
                       ▼
     ┌─────────── EC2 t4g.small · default VPC · one AZ · Elastic IP ───────────┐
     │  Caddy (TLS, Let's Encrypt)                                             │
     │    ├── api.bindersnap.com   → API/BFF (Bun)  ── sessions.db (SQLite)    │
     │    └── gitea.bindersnap.com → Gitea 1.27.3   ── gitea.db (SQLite)       │
     │                                              └─ /data/git/repositories  │
     │  Litestream 0.3 ── replicates both .db files ──────────────┐            │
     │  CloudWatch agent (disk, mem)                               │            │
     │                                                             │            │
     │  EBS gp3 20 GB "/data" (Docker data-root, all volumes)      │            │
     │     └── DLM: 1 snapshot/day, keep 7 ─── same region ──┐     │            │
     └───────────────────────────────────────────────────────┼─────┼────────────┘
                                                             ▼     ▼
                                                  EBS snapshots   S3 bindersnap-litestream-*
                                                  (us-east-1)     (us-east-1, versioned 30 d)

SPA: GitHub Pages (pages.yml)        Deploys: GitHub OIDC → SSM → pyinfra
Secrets: SSM Parameter Store + KMS   State: S3 + DynamoDB lock
Alarms → SNS: status check, CPU, disk, memory, Stripe webhook 5xx
```

This is a sensible shape for a pre-launch product with one developer. ADR 0003
picked it on purpose, and this review does not reopen that. A single host is
fine. What isn't fine is a single host whose repository data has no reliable
off-host copy.

### Data assets and how each is protected (before this branch)

| Asset                                                     | Where                               | Backup                   | RPO              | Leaves region / account? | Restore tested? |
| --------------------------------------------------------- | ----------------------------------- | ------------------------ | ---------------- | ------------------------ | --------------- |
| **Git repositories** (documents, versions, uploads, tags) | `gitea-data` volume → `/data/git`   | DLM daily snapshot only  | **24 h (or ∞)**  | **No / No**              | **No**          |
| Gitea DB (PRs, reviews, approvals, comments, users)       | `gitea-data` → `gitea.db`           | Litestream + DLM         | ~1 s (24 h PITR) | No / No                  | No              |
| API DB (sessions, orgs, billing, settings)                | `api-data` → `sessions.db`          | Litestream + DLM         | ~1 s (24 h PITR) | No / No                  | No              |
| Gitea attachments / avatars / LFS                         | `gitea-data` → `/data/gitea`, `lfs` | DLM daily snapshot only  | 24 h             | No / No                  | No              |
| TLS certs / ACME account                                  | `caddy-data`                        | DLM (re-issuable anyway) | n/a              | —                        | —               |
| Secrets                                                   | SSM Parameter Store                 | Terraform state (see H6) | —                | No / No                  | —               |
| Terraform state                                           | S3 (versioned 90 d, KMS)            | S3 versioning            | —                | No / No                  | —               |

---

## 2. Findings

Severity is about the business: **Critical** can lose customer data or turn a
routine failure into an unrecoverable one. ✅ marks what this branch fixes.

### Critical: backup and restore

**C1. Git repositories have no off-host continuous backup.**
`deploy/files/litestream.yml` lists only `gitea.db` and `sessions.db`. The
repositories sit on the same volume and are covered only by DLM. RPO is 24 h,
and there is one copy, in one region, in one account.
✅ _Partly fixed:_ DLM now snapshots **hourly** (48 kept) plus daily (35 kept),
and **copies the daily snapshot to `us-west-2`**. RPO goes from 24 h to 1 h, and
a regional outage or a deleted volume is now survivable. _Still open:_ an
independent, non-EBS copy (Phase 0, item 3).

**C2. The DLM policy could be silently doing nothing.**
`execution_role_arn` pointed at `AWSDataLifecycleManagerDefaultRole`, which only
exists if someone once ran `aws dlm create-default-role`. Nothing checked that
snapshots were actually being taken.
✅ _Fixed:_ the role is now created in Terraform (`bindersnap-dlm`). Three new
alarms page on a failed snapshot, **no completed snapshot in 6 h**, and a failed
DR copy. **Action for you now:** before applying, check the snapshots that exist
today: `aws ec2 describe-snapshots --owner-ids self --filters Name=tag:Project,Values=bindersnap`.
If the list is empty, the gap has been real, not theoretical.

**C3. The two backup mechanisms restore to different moments.**
Litestream restores `gitea.db` to a point seconds ago. DLM restores the
repositories to a point up to 24 h ago (now 1 h). If you restore both, Gitea
rows (PRs, reviews, **approvals**, commit statuses) will reference commits that
are missing from the repositories. For a compliance product those approvals are
the evidence. The rule to write down:

> **Full-host loss:** restore the whole volume from **one** EBS snapshot. Do
> not overlay a newer Litestream `gitea.db` on it. Use Litestream alone only
> for a corrupted or mis-migrated `gitea.db` when the repositories are intact
> (e.g. a bad Gitea upgrade, see `docs/ops/deploy.md`).

`sessions.db` has no such coupling, so always take its latest copy from
Litestream.

**C4. The restore script does not work on the production host.**
`scripts/restore.sh` writes to `/data/gitea/gitea.db` and `/data/api/sessions.db`.
Those are the paths _inside the Litestream container_. On the host, Gitea reads
`/data/docker/volumes/bindersnap_gitea-data/_data/gitea.db`. The script also
expects a `litestream` binary on the host, and `deploy.py` never installs one.
A restore run as documented would report success and change nothing Gitea reads.
No restore has ever been rehearsed.
Rebuilding the host is not written down either. `infra/compute` has no
`snapshot_id` input, and `prevent_destroy` on `aws_ebs_volume.data` blocks
swapping in a restored volume, so today a restore means hand-editing Terraform
state. The order also matters: the restored volume must be attached **before**
the first deploy. The real service token in SSM skips the Gitea bootstrap, so
the API would otherwise start against a Gitea that has never heard of it.
_Fix (Phase 0):_ run the restore through the image already in use, for example
`docker run --rm -v bindersnap_gitea-data:/data/gitea litestream/litestream:0.3 restore -o /data/gitea/gitea.db s3://$BUCKET/gitea`,
and update `scripts/restore.test.ts` to match. Then run a real drill (Phase 0,
item 4).

**C5. Litestream can fail silently.**
The sidecar has no healthcheck, no metric, and no alarm. Any of these stops
replication with no page: a wrong `litestream_s3_bucket` (its Terraform default
is the placeholder `bindersnap-litestream-REPLACE_WITH_ACCOUNT_ID`), a detached
IAM policy, or a crash loop. The image tag `litestream/litestream:0.3` also
floats. And Litestream's default `retention` is 24 h, so point-in-time restore
covers only the last day. Older generations survive only as S3 noncurrent
versions, which are awkward to restore.
_Fix (Phase 0):_ pin the image digest. Add a host timer that publishes "age of
the newest object under `s3://…/gitea/`" as a CloudWatch metric, with an alarm
at > 15 min. Set `retention: 168h` (7 days) in `litestream.yml`.

**C6. Every backup can be deleted by one set of credentials.**
Snapshots, the Litestream bucket, and Terraform state all live in the
production account. The instance role holds `s3:DeleteObject` on the backup
bucket. Versioning helps, but noncurrent versions expire after 30 days. A
leaked admin credential, ransomware on an operator laptop, or a billing
suspension could take production and its backups together.
_Fix (Phase 1):_ copy to a separate backup account (AWS Backup vault with
**Vault Lock**, or S3 with **Object Lock** in compliance mode).

**C7. A deploy or reboot without the data volume replaced the backup with an
empty database.** ✅ _Fixed._
`deploy.py` detects the data volume with the `DataDevice` fact. When the fact
came back empty, the old `else:` branch only printed
`WARNING: EBS data volume not found — Docker will use root volume` and carried
on. The Gitea service-token bootstrap and `bindersnap-stack-up` then brought the
stack up on the root disk. Gitea (`INSTALL_LOCK=true`) creates a new empty
`gitea.db`, and Litestream starts replicating it as the newest generation.
Litestream's retention then prunes the old generations, leaving the real data
only in S3 noncurrent versions for 30 days. At boot, `/data` is mounted
`nofail`, and `docker.service` had no ordering on it. If the volume was late or
missing, Docker could start with an empty data-root on the root disk.
Three guards now make this fail closed:

- `deploy.py` **aborts the deploy** when no data volume is found.
- `docker.service` gets a drop-in with `RequiresMountsFor=/data`, so Docker
  does not start without the mount.
- `bindersnap-stack-up` refuses to start anything when `/data` is not a
  mountpoint, which also covers manual break-glass runs.

A missing volume now means the site is down (loud, and caught by H3's probe)
instead of quietly forking the data.

### High

**H1. The disk-full alarm could never fire.** ✅ _Fixed._
The CloudWatch agent tags `disk_used_percent` with `path`, `device` and
`fstype` as well as `InstanceId`. The alarm looks for `InstanceId` alone, a
series that did not exist, and `treat_missing_data = "notBreaching"` kept it
green forever. A full `/data` stops Gitea, SQLite and Litestream all at once.
The agent config now adds `aggregation_dimensions: [["InstanceId"]]`, so the
series exists and `Maximum` reads the fullest mount.

**H2. Docker logs are never rotated.** `deploy/files/daemon.json` sets only
`data-root`. Gitea, Caddy and Litestream log through the default `json-file`
driver with no size cap, onto the same `/data` volume as the repositories.
_Fix (Phase 0):_ add `"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}`.
Changing `daemon.json` restarts Docker during the deploy, a few seconds of
downtime, so ship it in a quiet window.

**H3. Nothing checks the product from outside.** The status-check alarm watches
the VM. If Caddy, Gitea or the API is down on a healthy VM, nobody is paged.
Alerts also go nowhere unless `alert_email` was set and the SNS subscription
confirmed.
_Fix (Phase 0):_ a Route 53 health check (or Cloudflare health check) on
`https://api.bindersnap.com/healthz` and Gitea's `/api/healthz`, alarming to
SNS. Confirm the subscription.

**H4. Gitea is fully public.** `gitea.bindersnap.com` serves the whole Gitea
UI and API, including `/admin` (the IP allowlist in `Caddyfile.prod` is
commented out), to the internet. The BFF reaches Gitea on the Docker network,
and non-negotiable #1 says the browser never holds Gitea credentials. The
browser only needs avatar URLs (Gitea builds them from `ROOT_URL`).
_Fix (Phase 1):_ in Caddy, serve only `/avatars/*` and `/repo-avatars/*`
publicly and 404 everything else. Longer term, proxy avatars through the BFF and
drop the public hostname. Check the browser's actual Gitea requests before
tightening.

**H5. The origin is exposed directly.** The Elastic IP takes traffic on :80 and
:443 from anywhere, with no WAF, CDN or DDoS absorption in front, and only
Caddy's per-IP limit on the webhook route.
_Fix (Phase 1):_ put Cloudflare in front, proxied DNS, free tier. Then either
limit the security group to Cloudflare's IP ranges or, better, run
**Cloudflare Tunnel** (`cloudflared`) and close every inbound port. With a
tunnel, SSM becomes the only way in.

**H6. Live secrets sit in Terraform state.** `infra/secrets/main.tf` takes the
Stripe live keys and Gitea secrets as variables, so they are stored in plain
text in `secrets/terraform.tfstate`. The bucket is KMS-encrypted, but anyone who
can read it can read them. Every apply also needs them in a local `tfvars`.
_Fix (Phase 1):_ create the parameters with placeholder values and
`lifecycle { ignore_changes = [value] }`, set the real values with
`aws ssm put-parameter`, or move to write-only `value_wo` when the provider pin
allows it. Rotate the Stripe keys afterwards.

**H7. Pushing a tag can deploy to production.** The OIDC trust in
`infra/ci/oidc.tf` accepts `ref:refs/tags/*`. Anyone who can push a tag can
deploy any commit and skip `main`'s branch protection.
_Fix (Phase 1):_ trust `repo:…:environment:production` only, and protect that
GitHub environment with required reviewers or restrict it to `main`.

**H8. Single host, single AZ, and no stated RTO.** ADR 0003 accepts this for
pre-launch and says to revisit before promising an SLA. Today's honest RTO is
"a few hours if the operator remembers the steps". There is no written
full-host restore runbook.
_Fix (Phase 0/1):_ write it (§5), then rehearse it (Phase 0, item 4).

**H9. A deploy reports success without checking the app is up.**
`bindersnap-stack-up` ends with `docker compose ps`. Nothing waits for the API
or Gitea to become healthy, and nothing calls `/healthz` through Caddy. An
image that crashes on start still deploys green, and the first sign is a user.
_Fix (Phase 0):_ after `up`, poll `https://api.bindersnap.com/healthz` (and
Gitea's `/api/healthz`) for up to about 2 min and fail the workflow if it never
answers. The rollback is already one `workflow_dispatch` away.

**H10. Any push to `main` can restart the whole stack.**
`dnf.packages(... ["docker", "awscli", "xfsprogs"], update=True)` upgrades
Docker whenever a newer package exists. Upgrading the package restarts
`dockerd` and every container, at whatever time a push lands. A change to
`Caddyfile.prod`, `litestream.yml` or any other config file also force-recreates
**all** services (`up -d --build --force-recreate`), including Gitea, though
only one of them needed it.
_Fix (Phase 1):_ drop `update=True` and upgrade Docker with the patching
window (M1). Recreate only the services whose inputs changed, for example with
a `config` hash label per service, so compose recreates each service only when
its hash changes.

### Medium

- **M1. No patching.** The AMI is `ignore_changes`, and nothing runs
  `dnf upgrade`. _Fix:_ an SSM Patch Manager baseline and maintenance window,
  or `dnf-automatic` for security updates from `deploy.py`.
- **M2. Floating image tags.** `alpine:latest`, `litestream/litestream:0.3`,
  `caddy:2-builder` / `caddy:2-alpine` (`Dockerfile.caddy`), the unpinned
  `caddy-ratelimit` module, and `oven/bun:1` in the Gitea bootstrap are pulled
  fresh on **every** deploy (`bindersnap-stack-up` runs `compose pull`). So a
  backup-agent or TLS-proxy upgrade can ride along with any push, untested.
  _Fix:_ pin digests and let Renovate/Dependabot bump them.
- **M3. Terraform runs by hand only.** `apply-all.sh` applies from a laptop
  with `-auto-approve`, with no CI plan and no drift detection. The monitoring
  module's `instance_id` default is a fake ID. _Fix:_ a scheduled
  `terraform plan -detailed-exitcode` in CI with a read-only OIDC role that
  alerts on drift.
- **M4. No account guardrails in code.** CloudTrail, GuardDuty, an AWS Budget,
  and IAM Access Analyzer are not in `infra/`. They may exist but can't be
  verified from the repo. _Fix:_ an `infra/account-baseline` module. The
  Budget alarm matters most: it is the only thing that catches a runaway bill.
- **M5. The backup bucket is only partly hardened.** No TLS-only bucket policy
  and no explicit SSE. S3's default SSE-S3 applies, which is fine, but make it
  explicit.
- **M6. Tight memory headroom.** t4g.small has 2 GiB for Gitea, the API,
  Caddy and Litestream, on burstable CPU. Watch the `mem_high` alarm, and move
  to t4g.medium (+ ~$12/mo) before launch.
- **M7. Gitea's SQLite journal mode is implicit.** Litestream needs WAL and
  switches the database to it on start. Gitea does not set it
  (`SQLITE_JOURNAL_MODE` is empty). Set `GITEA__database__SQLITE_JOURNAL_MODE=WAL`
  in `docker-compose.prod.yml` so the requirement is explicit and survives a
  Gitea upgrade.
- **M8. The deploy's GHCR login expires with the run.** `deploy.py` logs the
  host into GHCR with the workflow's `GITHUB_TOKEN`, which dies when the run
  ends. A break-glass `compose pull api` from the host (break-glass step 3)
  cannot fetch the private image later. _Fix:_ a read-only `packages:read`
  token in SSM for the host, or document that break-glass pins only images
  already on disk.

### What is already good

IMDSv2 enforced. EBS encrypted, with `prevent_destroy` on the data volume. No
inbound SSH, and deploys use SSM with an ephemeral EC2 Instance Connect key. The
OIDC deploy role is least-privilege and tag-scoped. SSM SecureStrings use a
customer-managed KMS key with rotation. Terraform state is versioned and locked.
The API image is pinned to a commit SHA, and the break-glass runbook is real.
In `deploy/`: configuration is validated before any `up` (compose config and a
real Caddy build), the stack is recreated only when config or env changed,
`.env.prod` is rendered in memory and lands at `0600`, the Compose plugin is
version-pinned, and first-run Gitea bootstrap is idempotent.

---

## 3. Targets, sized to the business

The brief's generic checklist (99.99 %, multi-region, multi-cloud) does not fit
this product today. Gitea on SQLite runs on one node and does not cluster, so
99.99 % would mean rewriting the data layer. That is exactly the trap ADR 0002
fell into and ADR 0003 backed out of. The whole bill is about $25/month, so a
"30 % cost reduction" is not a meaningful goal either. The right targets are
about **never losing a customer's record** and **recovering predictably**:

| Objective                              | Today               | Target (pre-launch → first paying customers)      |
| -------------------------------------- | ------------------- | ------------------------------------------------- |
| RPO, documents (git)                   | 24 h, maybe ∞       | **≤ 1 h now (this branch) → ≤ 15 min in Phase 1** |
| RPO, databases                         | seconds             | seconds (unchanged)                               |
| RTO, full host loss                    | unknown, untested   | **≤ 2 h, rehearsed quarterly**                    |
| Backup copies off-account / off-region | 0 / 0               | **1 / 1**                                         |
| Availability                           | ~99.5 % (1 VM)      | 99.9 % monthly, single host + fast rebuild        |
| Time to detect an outage               | only if the VM dies | ≤ 5 min (external probe)                          |

Revisit multi-AZ only when a contract requires an SLA above 99.9 %. The path
for that is in Phase 3.

---

## 4. Target architecture

```
                         Users
                           │
                 ┌─────────▼──────────┐
                 │ Cloudflare (proxy) │  WAF · DDoS · TLS edge · health checks
                 └─────────┬──────────┘
                           │ Cloudflare Tunnel (outbound-only; no inbound ports)
   ┌───────────────────────▼──────────────── prod account · us-east-1 ───────────┐
   │ EC2 (t4g.medium) — same compose stack, pinned digests, patched weekly       │
   │   Caddy → API/BFF ; Gitea reachable only on the Docker network (+ avatars)  │
   │   Litestream  ── continuous ──► S3 litestream (7 d PITR) ──┐                │
   │   backup timer ── gitea dump / repo bundle every 15 min ──►│ S3 repo-backup │
   │   CloudWatch agent ── disk/mem + "replica age" metrics      │ (Object Lock)  │
   │ EBS /data ── DLM hourly(48) + daily(35) ──┐                 │                │
   └───────────────────────────────────────────┼─────────────────┼────────────────┘
                                               │ cross-region    │ S3 replication
                                               ▼                 ▼
                       us-west-2 snapshot copies (35 d)   backup account (separate
                                                          credentials): Object Lock
                                                          compliance, 90 d; AWS Backup
                                                          vault with Vault Lock
   Observability: CloudWatch alarms + external probes → SNS → email/phone
   Governance: CloudTrail (org) · GuardDuty · Budgets · Terraform plan-drift in CI
```

The design rests on three independent copies, each made a different way:

1. **EBS snapshots.** Block-level and crash-consistent across the database and
   repositories together. The fastest full-host restore (RTO under 30 min).
   Now hourly, with a DR-region copy.
2. **Litestream.** Continuous and to the second, for the SQLite databases only.
   The tool for a bad migration or a corrupted database.
3. **A logical repository backup.** New. A 15-minute timer on the host runs
   `git bundle` for each repository changed since the last run (or a nightly
   `gitea dump` while the data is small), writes it to an S3 bucket with
   Object Lock, and replicates it to a **separate AWS account**. It does not
   depend on EBS or on AWS snapshot formats. It can be restored to any Gitea,
   including one outside AWS, and no credential in the production account can
   delete it. This covers the ransomware, rogue-admin and account-loss cases,
   and it is the lock-in mitigation that actually matters here.

Nothing in this breaks the non-negotiables. The evidence stays in Gitea. The
backups are copies of Gitea's own data and never a second source of truth.
Terraform still provisions only, and `deploy/` configures the host.

---

## 5. Roadmap

### Phase 0: close the hole (this week)

1. ✅ Hourly + daily DLM, DR-region copy, Terraform-owned DLM role, backup
   alarms, disk-alarm fix. The stack now refuses to run without the data
   volume (C7). **(this branch; apply it)**
2. Fix `scripts/restore.sh` to restore into the Docker volume through the
   Litestream image (C4). Set Litestream `retention: 168h`, pin its digest, and
   add the replica-age metric and alarm (C5).
3. A repository backup timer in `deploy.py` (git bundles or `gitea dump` →
   new S3 bucket with Object Lock), plus an alarm on the age of the newest
   object. Terraform: the bucket and a write-only (`s3:PutObject`) grant for
   the instance role.
4. **Restore drill.** In a scratch account or VPC: create a volume from the
   newest snapshot, attach it to a fresh `compute` apply, run the deploy,
   log in, open a document, check its history and approvals. Record the
   wall-clock time as the RTO. Write it up as `docs/ops/restore.md`, including
   the C3 rule.
5. Docker log rotation (H2). External health checks and a confirmed SNS
   subscription (H3). A post-deploy health gate in `deploy-pyinfra.yml` (H9).
6. A `data_volume_snapshot_id` path in `infra/compute` (or a documented
   `terraform state rm` + import sequence) so a restore does not need state
   surgery under pressure (C4).

### Phase 1: harden (next 2–4 weeks, before paying customers)

7. A separate **backup account**: S3 replication of the Litestream and
   repository buckets into Object Lock (compliance mode) buckets, and/or AWS
   Backup with Vault Lock, cross-account copy and **AWS Backup restore
   testing**, which runs the drill in item 4 automatically every month.
8. Cloudflare in front, then Cloudflare Tunnel, then close :80 and :443 (H5).
   Lock Gitea down to avatars only (H4).
9. Secrets out of Terraform state and the Stripe keys rotated (H6). OIDC
   trust changed to a protected `production` environment (H7).
10. An account baseline module: CloudTrail, GuardDuty, Budgets, Access Analyzer
    (M4). CI drift detection for Terraform (M3).
11. Patching (M1), with Docker upgrades moved out of deploys and per-service
    recreates (H10). Pinned digests with Renovate (M2), and t4g.medium (M6).

### Phase 2: operate (ongoing)

- Quarterly game day: restore from each of the three copies in turn.
- A monthly cost review. Savings Plan or Reserved Instance on the instance
  once its size settles (~30–40 % off compute, about $4–8/month).
- Promote the RPO/RTO table into ADR 0003's "revisit" note once it has been
  met in a drill.

### Phase 3: only when a contract needs > 99.9 % (not planned)

A warm standby in a second AZ, fed by the 15-minute repository backups and
Litestream, with Route 53 / Cloudflare failover. RTO goes from about 30 min to
a few minutes. Anything active-active needs Gitea on Postgres plus shared
repository storage. That is a data-layer project and needs its own ADR.

---

## 6. Cost

| Item                                           | Today (≈/mo) | After Phase 0–1 (≈/mo) |
| ---------------------------------------------- | ------------ | ---------------------- |
| EC2 t4g.small → t4g.medium                     | $12          | $24                    |
| EBS gp3 30 + 20 GB                             | $4           | $4                     |
| Public IPv4 (EIP)                              | $3.60        | $0 with Tunnel         |
| EBS snapshots (incremental, hourly + daily)    | <$1          | $1–3                   |
| Cross-region copy + storage (us-west-2)        | —            | $1–2                   |
| S3 (Litestream + repo backups + Object Lock)   | <$1          | $1–2                   |
| CloudWatch, SNS, KMS, SSM, health checks       | ~$3          | ~$5                    |
| Cloudflare (free plan), GuardDuty (small acct) | —            | ~$2                    |
| **Total**                                      | **≈ $25**    | **≈ $38–42**           |

About $15 a month more turns "we might have lost a day of every customer's
documents" into "three independent copies, one of which cannot be deleted".
Once the instance size settles, a Savings Plan pays back roughly half of the
increase.

---

## What this branch changes

| File                                        | Change                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `infra/backups/dlm.tf`                      | Terraform-owned `bindersnap-dlm` role. Hourly schedule (keep 48). Daily keeps 35, not 7. Daily copied to `var.dr_region` (default `us-west-2`, 35 days). New `dlm_policy_id` output. |
| `infra/backups/main.tf`                     | Variables for the new retention settings and DR region (`dr_region = null` turns the copy off).                                                                                      |
| `infra/monitoring/main.tf`                  | Alarms for a failed snapshot, no snapshot in 6 h, and a failed DR copy. They are created only when `dlm_policy_id` is set.                                                           |
| `infra/apply-all.sh`                        | Passes `dlm_policy_id` from backups into monitoring.                                                                                                                                 |
| `deploy/deploy.py`                          | Aborts the deploy when the EBS data volume is missing, instead of falling back to the root disk. Installs the Docker drop-in below (C7).                                             |
| `deploy/files/docker-requires-data.conf`    | New `docker.service` drop-in: `RequiresMountsFor=/data`. Docker is ordered after the data mount and does not start without it (C7).                                                  |
| `deploy/files/bin/bindersnap-stack-up`      | Refuses to start the stack when `/data` is not a mountpoint (C7). Covered by a new test in `scripts/deploy-pyinfra.test.ts`.                                                         |
| `deploy/files/cloudwatch-agent-config.json` | `aggregation_dimensions: [["InstanceId"]]`, so the disk alarm has a series to read (H1). Takes effect on the next deploy.                                                            |

**To roll out:** merge, then run `cd infra && ./apply-all.sh plan` and check
that the plan shows only in-place changes to the DLM policy plus the new
role and alarms. Then `./apply-all.sh`. After the next top of the hour, confirm
an hourly snapshot exists, and that the `bindersnap-backup-no-recent-snapshot`
alarm reads OK once DLM has reported its first metrics.
The `deploy/` changes go out with the normal `main` deploy. On the current host
they change nothing visible: the volume is present, so the abort branch never
runs, and adding the drop-in only needs `systemctl daemon-reload`, not a Docker
restart. A `--dry` run (`deploy/bin/ssm-connect.sh --dry`) before merging should
show just the drop-in, the reload, and the agent config.
