# Production architecture: the cutover design

_Written 2026-10-08 against `development/binders-gitea-28`. It builds on the
review in #620 (`docs/ops/cloud-architecture-review.md`) and replaces its §4
"Target architecture" and Phase 1. Production is wiped and rebuilt from empty
when `development/binders-gitea-28` merges, so nothing here migrates data._

## Decisions

| Question                             | Answer                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Static hosting                       | **Cloudflare Workers static assets**, two projects: `bindersnap.com` (site) and `app.bindersnap.com` (SPA)         |
| Move anything else to Cloudflare?    | **Yes, the edge:** DNS, proxy/WAF, Tunnel, Turnstile, and R2 for the off-provider backup                           |
| Move the API or Gitea to Cloudflare? | **No**                                                                                                             |
| GCP Cloud Run (scale to zero)?       | **No.** Neither container can scale to zero, and Gitea can't run there at all (see below)                          |
| Where do the SQLite databases run?   | **On the same host as the process that writes them**, on the EBS data volume, replicated by Litestream             |
| Compute                              | One EC2 `t4g.medium`, as today. **No inbound ports**                                                               |
| Off-site, undeletable backup         | **restic → R2 with a bucket lock**, instead of the separate AWS backup account #620 proposed                       |
| Email                                | **Inbound: Cloudflare Email Routing, now. Outbound: stay on SES** until Cloudflare Email Sending leaves beta (§2a) |
| Legal pages                          | **Must change before the first customer**: Cloudflare becomes a subprocessor, and backup retention changes (§8)    |

---

## 1. Target

```
                                 Users
                                   │
          ┌────────────────────────▼─────────────────────────────┐
          │ Cloudflare  (DNS · proxy · WAF · rate limits ·       │
          │              Turnstile · health checks)              │
          │                                                      │
          │  bindersnap.com ──────► Worker static assets: site   │  GA allowed here only
          │  app.bindersnap.com ──► Worker static assets: SPA    │  CSP/HSTS via _headers
          │  api.bindersnap.com ──► Tunnel ─────────┐            │
          │                                         │            │
          │  R2 bindersnap-backup (bucket lock 35 d)◄──────────┐ │
          └─────────────────────────────────────────┼─────────┼─┘
                       outbound-only tunnel          │         │ restic, hourly
   ┌─────────────────────────────────────────────────▼─────────┼───────────── AWS us-east-1 ┐
   │ EC2 t4g.medium · security group: 0 inbound rules · SSM for operators                   │
   │   cloudflared → Caddy → API/BFF (Bun) ── sessions.db                                   │
   │                         └──► Gitea 28 (Docker network only) ── gitea.db + repositories │
   │   Litestream ── continuous ──► S3 bindersnap-litestream (7 d PITR)                     │
   │   backup timer ── restic, hourly ─────────────────────────────────────────┘            │
   │   CloudWatch agent · dnf-automatic (security) · pinned image digests                   │
   │ EBS /data ── DLM hourly(48) + daily(35) ── daily copy to us-west-2 (#618/#619)         │
   └────────────────────────────────────────────────────────────────────────────────────────┘
   Outbound email: SES (infra/email, unchanged)     Billing: Stripe → api.bindersnap.com/stripe/webhook
   Alerts: CloudWatch + Cloudflare health checks → SNS/email     Guardrails: CloudTrail · GuardDuty · Budgets
```

Hostnames that exist after cutover: `bindersnap.com`, `www` (redirect),
`app.`, `api.`, and SES's records on `users.`/`mail.` **`gitea.bindersnap.com`
goes away** (§4, S3).

---

## 2. What goes to Cloudflare, and what doesn't

### Move

1. **DNS.** Move the zone to Cloudflare first. Everything else depends on it.
   Recreate the SES DKIM/SPF/MAIL FROM records from `infra/email` outputs as
   **DNS-only** (grey cloud). Add DMARC (`p=quarantine` once SES reports
   clean) and CAA records allowing only the CAs you use.
2. **Static hosting, as two Workers with static assets.** Cloudflare now
   steers new projects to Workers over Pages; both serve static files free.
   - `bindersnap.com`: the output of `scripts/build-site.ts`, `build-help.ts`,
     `build-legal.ts`. The Google tag lives here only.
   - `app.bindersnap.com`: the `bun build apps/app/index.html` output, with
     `not_found_handling = "single-page-application"` and a `_headers` file
     carrying CSP, `X-Frame-Options: DENY`, `Referrer-Policy`, and HSTS. That
     replaces the frame-busting script GitHub Pages forced on you (#132), and
     finishes issue #718 without putting the SPA on the EC2 host.
   - Deploy both from GitHub Actions with `wrangler deploy` and an API token
     scoped to those two Workers. PRs get preview URLs. `pages.yml` goes away.
3. **Proxy + WAF in front of the API.** Free-plan managed ruleset, plus
   rate-limiting rules on `POST /auth/*`, password reset, signup, and
   `/stripe/webhook`. Keep the API's own limiter too; the edge one stops floods
   before they reach the host.
4. **Cloudflare Tunnel.** `cloudflared` runs as a container in the prod
   compose and dials out. The security group loses its `:80`/`:443` rules,
   and the Elastic IP is released. Caddy stops doing ACME: Cloudflare
   terminates public TLS, and the tunnel is encrypted to it.
5. **Turnstile** on signup, sign-in after N failures, and password reset. The
   API verifies the token server-side. Free, no Google.
6. **R2** for the third backup copy (§3). It is a different company, different
   credentials, no egress fee to restore, and a bucket lock means no token can
   delete it.
7. **Health checks.** An external check on `https://api.bindersnap.com/healthz`
   every minute, alerting to email. (Cloudflare's health checks need a paid
   plan; a free UptimeRobot or Better Stack monitor does the same job.)

### Don't move

- **The API (BFF).** It is ~16k lines of Bun with `bun:sqlite`, it talks to
  Gitea over the Docker network on every request, and it runs in-process
  timers: the job runner, the email outbox, the Stripe reconcile every 6 h,
  and seat sync. A Worker has none of that: no local disk, no long-lived
  process, and a round trip to Gitea in another cloud on every call.
- **Gitea.** Needs a POSIX filesystem with real locking for git and SQLite.
- **Outbound email, for now.** See §2a.
- **Hocuspocus.** It is in the dev compose only; the app doesn't call it in
  production. Leave it out of prod until real-time editing ships.

## 2a. Email

The domain is on Cloudflare now, so Cloudflare's **Email Service** is an
option. It has two halves, and they get different answers.

### Inbound: use Cloudflare Email Routing now

The legal pages publish `privacy@`, `security@` and `team@bindersnap.com`, and
the DPA's objection process runs through `privacy@`. Nothing in this repo receives mail for
them, and any forwarding set up at the old registrar likely stopped working with the
transfer. **Send a test to each before launch.** Email Routing is free on every plan:

- Turn it on for the apex. Cloudflare adds the MX and SPF records itself.
- Route `privacy@`, `security@`, `team@` and a catch-all to a verified
  destination inbox you read.
- Route `notifications@` (the From address) to the same inbox, so replies and
  bounce notices land somewhere.
- SES's MAIL FROM uses a subdomain (`infra/email`, `mail_from_subdomain`), so
  its MX record doesn't collide with the apex MX.

### Outbound: stay on SES for the cutover, switch when Email Sending is GA

|                       | Amazon SES (built, in `infra/email`)                     | Cloudflare Email Sending                                                                |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Status                | GA                                                       | **Public beta since April 2026**; APIs may change before GA                             |
| Price at our volume   | $0.10 per 1,000, no minimum: effectively $0              | Needs **Workers Paid ($5/mo)**, 3,000 included, then $0.35 per 1,000                    |
| Credentials on host   | **None**: the instance role, limited to one From address | An API token in SSM (scope it to Email Sending only)                                    |
| Getting started       | DNS records plus a **production-access request**         | Onboard the domain; you can then send to anyone. Starts with a conservative daily quota |
| Limits that matter    | none at our size                                         | 50 recipients per message, 5 MiB per message: fine for our emails                       |
| Bounces, complaints   | Account suppression list; SNS events available           | Automatic suppression list; **no bounce/complaint webhooks**                            |
| DNS                   | Records added by hand from Terraform outputs             | Configured inside Cloudflare                                                            |
| From a Bun API on EC2 | AWS SDK (today)                                          | REST `POST /accounts/{id}/email/sending/send`, or SMTP on `smtp.mx.cloudflare.net:465`  |

Signup verification (#713) and password reset depend on email, so a beta
outage would block new customers from signing up. SES is GA, holds no secret
on the host, and costs nothing at this volume. **Keep SES as the outbound
transport at cutover.**

Switch to Cloudflare when either:

- Email Sending reaches GA, and you want one vendor for DNS and mail; or
- SES refuses or stalls the production-access request. If that request isn't
  approved yet, file it now, because SES's sandbox only sends to verified
  addresses.

The switch is small. `services/api/mail/transport.ts` already puts SES and
Mailpit behind one `MailTransport` interface, and every email is a single
recipient with no attachments. A `cloudflareTransport` is a `fetch` to the
REST endpoint. Map 4xx (except 429) to a permanent `MailSendError` and 429/5xx
to a retryable one. Then add `cloudflare` to `MailTransportName` in
`config.ts`, and add the token to `deploy/env_render.py`. The outbox's
retries and the `mail_transport` SSM switch already cover rollout and
rollback.

### Why not GCP Cloud Run

Scale to zero is the wrong saving for this product, and the platform doesn't
fit either container:

- **Gitea can't run there.** Its repositories and `gitea.db` need a disk with
  file locking. Cloud Run's Cloud Storage volume is FUSE, is not POSIX, and
  has no file locking: concurrent writes are last-writer-wins. The only real
  filesystem option is Filestore over NFS, which starts at hundreds of dollars
  a month, and SQLite over NFS is unsafe anyway. Gitea also doesn't cluster,
  so it needs exactly one instance, always on.
- **The API can't scale to zero either.** At zero, the outbox, job runner,
  Stripe reconcile and seat sync all stop. Writes to `sessions.db` need one
  instance, so you would pin `max-instances=1` and `min-instances=1`, and
  pay for an always-on instance anyway.
- **It adds a second cloud's IAM, billing and logs** for one operator to
  secure, for a saving of perhaps $10 a month.

Revisit only if the API stops being stateful (sessions and jobs in a shared
database, not SQLite on disk), and even then Gitea stays on a VM.

---

## 3. Data: where it lives and how it survives

Everything that matters is on **one EBS gp3 volume** (`/data`) attached to the
host: `gitea.db`, the git repositories, and `sessions.db`. SQLite stays next to
the process that writes it. That is the case SQLite is built for, and at this
scale it's faster and simpler than any network database. Do not put SQLite on
NFS, FUSE, or EFS, and do not swap it for D1 or Turso: Gitea can't use them,
and the API would need a rewrite for no gain.

Gitea on Postgres is not needed for a first customer. Move it only when SQLite
write contention shows up in the latency metrics, and record that in an ADR.

### Three copies, made three different ways

| Copy                   | What                                         | RPO     | Protects against                                        | Status       |
| ---------------------- | -------------------------------------------- | ------- | ------------------------------------------------------- | ------------ |
| 1. EBS snapshots (DLM) | the whole volume, crash-consistent           | 1 h     | host loss, bad deploy, AZ loss (via us-west-2 copy)     | #618, #619   |
| 2. Litestream → S3     | `gitea.db`, `sessions.db`                    | seconds | a corrupted or mis-migrated database                    | live; harden |
| 3. restic → R2, locked | repositories + `sqlite3 .backup` of both DBs | 1 h     | AWS account compromise or loss, ransomware, a bad admin | **new**      |

**Copy 3, how it works.** A systemd timer on the host, once an hour:

1. `sqlite3 gitea.db ".backup /data/backup/staging/gitea.db"` and the same for
   `sessions.db`. `.backup` gives a consistent copy without stopping writes.
2. `restic backup` of the staging dir plus `/data/.../git/repositories` to
   `s3:https://<account>.r2.cloudflarestorage.com/bindersnap-backup`.
   restic deduplicates and encrypts on the client, so R2 only ever sees
   ciphertext.
3. Publish "seconds since last successful backup" to CloudWatch; alarm at
   > 2 h.

The DB copy is taken just before the repositories, so the restore can never
reference a commit that isn't there. Repositories may be a few seconds newer,
which is harmless: an unreferenced commit is just an orphan.

The R2 bucket gets a **35-day bucket lock**. Locked objects can't be deleted
or overwritten by anyone, including you, until the lock expires. Run
`restic forget --prune` weekly with `--keep-within 35d`, so prune only touches
objects the lock has already released. The R2 token lives in SSM; the
**restic repository password lives only in SSM and in your password
manager**, not in Terraform state.

This replaces #620's "separate AWS backup account with Object Lock": it
gives the same guarantee (no credential in the prod account can delete it),
it's off AWS entirely, and it costs cents.

**Restore rule (from #620, C3, still true):** for a full-host loss, restore
**one** EBS snapshot, or **one** restic snapshot. Never lay a newer
Litestream `gitea.db` over older repositories. Use Litestream alone only for a
bad migration when the repositories are intact.

### Litestream fixes that are part of the cutover

- Pin the image by digest. `litestream/litestream:0.3` floats today.
- `retention: 168h` in `litestream.yml` (7 days of point-in-time restore).
- A replica-age metric and alarm (> 15 min), as #620 C5 describes.
- Fix `scripts/restore.sh` to restore into the Docker volume through the
  Litestream image (#620 C4).

---

## 4. Security

Severity is "can this hurt the first customer". **Must** items block launch.

### Must, before the first customer

| #   | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | **No inbound ports.** Tunnel in, SSM for operators. Delete the `:80`/`:443`/SSH ingress rules and the EIP.                                                                                                                                                                                                                                                                                                                                                                       |
| S2  | **Real client IPs behind the tunnel.** Today Caddy sets `X-Forwarded-For {remote}` and `requestClientIp` (`services/api/server.ts:516`) reads XFF first. Behind a tunnel `{remote}` is `cloudflared`, so **every user would share one rate-limit bucket**: one attacker locks everyone out of sign-in. Set Caddy to forward `CF-Connecting-IP` as `X-Forwarded-For`. That header is trustworthy only because the origin is reachable through the tunnel alone, which S1 ensures. |
| S3  | **Gitea is not public.** Drop the `gitea.bindersnap.com` site block and DNS record. Serve avatars through the API (it already draws identicons in `services/api/identicon.ts`), so `avatar_url` points at `api.`. For admin work, use SSM port-forwarding to `gitea:3000`, or a tunnel hostname behind Cloudflare Access.                                                                                                                                                        |
| S4  | **Session cookie scoped to the API host.** Production defaults `BINDERSNAP_SESSION_COOKIE_DOMAIN` to `.bindersnap.com`, so the cookie is sent to the marketing site too, and any subdomain can set one that shadows it. With the SPA on `app.` calling `api.` with credentials, a host-only cookie on `api.bindersnap.com` is enough (`app.` and `api.` are same-site, so `SameSite=Lax` holds). Verify sign-in, the auth callback and sign-out after the change.                |
| S5  | **Secrets out of Terraform state** (#620 H6): create SSM parameters with placeholder values and `ignore_changes = [value]`, then set real values with `aws ssm put-parameter`. Generate fresh Stripe live keys and Gitea secrets at cutover; the wiped prod's old ones are retired.                                                                                                                                                                                              |
| S6  | **Deploy trust** (#620 H7): OIDC trusts `environment:production` only, not `refs/tags/*`. Protect that GitHub environment to `main`.                                                                                                                                                                                                                                                                                                                                             |
| S7  | **Account guardrails:** root MFA and no root keys; no IAM users with long-lived keys (OIDC and SSO only); CloudTrail; GuardDuty; an AWS Budget alarm. Cloudflare: 2FA on the account, API tokens scoped per job (one for static deploys, one for Terraform), never the global key.                                                                                                                                                                                               |
| S8  | **Edge headers:** CSP on `app.` (`default-src 'self'; connect-src 'self' https://api.bindersnap.com; frame-ancestors 'none'`, plus whatever the editor needs), HSTS with `includeSubDomains`, and "Always Use HTTPS".                                                                                                                                                                                                                                                            |
| S9  | **Bot protection:** Turnstile on signup and password reset; WAF rate limits as in §2.                                                                                                                                                                                                                                                                                                                                                                                            |
| S10 | **Patching and pinning:** `dnf-automatic` for security updates; drop `update=True` on Docker in `deploy.py` (#620 H10); pin `alpine`, `litestream`, `caddy`, `cloudflared` by digest with Renovate bumping them.                                                                                                                                                                                                                                                                 |

### Should, within the first month

- Stripe webhook: the API already verifies signatures. Optionally allow only
  Stripe's published webhook IPs on that path in the WAF.
- Gitea admin password and the service token rotated on a schedule; tokens
  already stay server-side (non-negotiable #1).
- A written incident note: who gets paged, where the logs are, how to rotate
  every secret (SSM paths, Stripe, R2 token, Cloudflare tokens).

### Already good (keep)

IMDSv2 only, encrypted EBS, `prevent_destroy` on the data volume, SSM-only
access, SSM SecureStrings under a customer KMS key, the BFF owning auth, the
API image pinned to a commit SHA, and the deploy refusing to run without the
data volume (#616).

---

## 5. Operations: the minimum for a production system

| Area          | Minimum                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detection     | External uptime check on `api.…/healthz` (1 min); CloudWatch: status check, CPU, memory, disk (#617), DLM (#619), Litestream age, restic age; **confirm the SNS email subscription**                |
| Deploys       | Post-deploy health gate in `deploy-pyinfra.yml`: poll `/healthz` through the tunnel for 2 min, fail the run otherwise (#620 H9). Static sites deploy atomically with instant rollback in Cloudflare |
| Logs          | API → CloudWatch Logs (`awslogs`, already). Rotate the other containers' logs (`daemon.json` `max-size`) (#620 H2). Set a retention (30 d) on the log group                                         |
| Errors        | An error tracker for the API and the SPA (Sentry's free tier is enough), with PII scrubbing on; list it as a subprocessor in the privacy policy                                                     |
| Recovery      | `docs/ops/restore.md` with both paths (EBS, restic). **One rehearsed restore before the first customer**, timed. Target RTO ≤ 2 h, RPO ≤ 1 h for documents, seconds for databases                   |
| Capacity      | `t4g.medium`; data volume 50 GB (25 MiB uploads add up); disk alarm at 80 %                                                                                                                         |
| Infra as code | A new `infra/edge` Terraform module with the Cloudflare provider: zone records, tunnel, WAF and rate-limit rules, the two Workers' custom domains, the R2 bucket and its lock                       |

---

## 6. Cost (≈ per month)

| Item                                                     | Today    | Target   |
| -------------------------------------------------------- | -------- | -------- |
| EC2 t4g.small → t4g.medium                               | $12      | $24      |
| EBS gp3 root 30 GB + data 20 → 50 GB                     | $4       | $6.40    |
| Public IPv4 (EIP → auto-assigned, still billed)          | $3.60    | $3.60    |
| EBS snapshots + us-west-2 copy                           | <$1      | $2–4     |
| S3 Litestream                                            | <$1      | <$1      |
| R2 (restic, a few GB; no egress)                         | —        | <$1      |
| CloudWatch, SNS, KMS, SSM, GuardDuty, CloudTrail         | ~$3      | ~$6      |
| Cloudflare (free plan: DNS, proxy, WAF, Tunnel, Workers) | —        | $0       |
| **Total**                                                | **~$25** | **~$45** |

The instance keeps a public IPv4 for outbound traffic. Removing it needs a
NAT gateway (~$32) or IPv6-only egress, neither worth it yet. Once the size
settles, a one-year Savings Plan takes ~30 % off the instance.

---

## 7. Cutover order

Production is wiped, so there is no migration, only an order that never
leaves a public port open or a backup unwatched.

1. Merge #616–#620 into `development/binders-gitea-28` (#619 conflicts with
   the branch's `infra/apply-all.sh`; resolve when rebasing the stack).
2. Move DNS to Cloudflare. Recreate SES records DNS-only. Confirm SES still
   verifies, and that SES production access is granted. Turn on Email Routing
   for `privacy@`, `security@`, `team@` and `notifications@` (§2a).
3. Ship the static Workers for `bindersnap.com` and `app.bindersnap.com` from
   the branch. Point the API's `BINDERSNAP_APP_ORIGIN` at `https://app.bindersnap.com`,
   cookie host-only (S4), Gitea's CORS block removed (S3).
4. `infra/edge`: tunnel, WAF, rate limits, R2 bucket + lock. `infra/compute`:
   `t4g.medium`, 50 GB data, no EIP, zero inbound rules.
5. Generate fresh secrets into SSM (S5). Apply `secrets`, `backups`,
   `monitoring`, `ci` (S6).
6. Merge the branch to `main`. The deploy builds the empty stack with
   `cloudflared`, the backup timer, and the health gate.
7. Run the restore drill against the new, near-empty prod: restore an EBS
   snapshot and a restic snapshot into a scratch instance, sign in, open a
   document, check history and approvals. Write the times into
   `docs/ops/restore.md`.
8. Publish the legal updates in §8.
9. Onboard the first customer.

## 8. Legal pages that must change before the first customer

`apps/legal/documents/subprocessors.md` and the DPA (§10.4, Annex 3) describe
today's hosting. This design breaks four of their statements, and #618 already
breaks one of them. There are no customers yet, so the DPA's 30-day notice
doesn't apply. Publish the new text before anyone signs.

| Statement today                                                                                    | Why it stops being true                                                                       | Change                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "All Customer Content … is stored only on our servers at Amazon Web Services"                      | Cloudflare terminates TLS for `api.` and sees requests in transit; R2 holds encrypted backups | **Add Cloudflare, Inc. as a subprocessor**: CDN, proxy and security, static hosting, encrypted backups (R2), and email routing (and sending, if you switch) |
| AWS location "USA (us-east-1)"                                                                     | #618 copies daily snapshots to us-west-2                                                      | "USA (us-east-1, with backup copies in us-west-2)"                                                                                                          |
| DPA 10.4: "daily disk snapshots: up to 7 days"; "versions in … backup storage (S3): up to 30 days" | #618 keeps daily snapshots 35 days and hourly ones 48 h; R2 keeps restic snapshots 35 days    | State each backup and its age-out: hourly snapshots 2 days, daily snapshots 35 days, database replicas 30 days, encrypted off-site backups 35 days          |
| GitHub hosts "our public website and the app's files (GitHub Pages)"                               | Static hosting moves to Cloudflare                                                            | Remove GitHub from "Other services"; Cloudflare's subprocessor entry covers hosting                                                                         |

Have counsel review the DPA wording. The rows above say what has to change,
not the legal text.

## What this changes in #620

- §4 "Target architecture" and the Phase 1 backup account (item 7) are
  replaced by §1–§3 here: R2 with a bucket lock is the off-account copy.
- Phase 1 item 8 (Cloudflare, Tunnel, Gitea locked down) moves into the
  cutover, as S1–S3.
- Non-negotiable #6 says "no serverless". Workers static assets serve files;
  they run no code of ours. ADR 0006
  (`docs/adr/0006-cloudflare-workers-at-the-edge.md`) records that reading, and
  the narrow rule for the first Worker that does run code: in-app feedback.
