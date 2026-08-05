# ADR 0003: Single EC2 Host with pyinfra Push Deploys

Status: Accepted  
Date: 2026-08-05  
Related: [Epic #302](https://github.com/davidgraymi/bindersnap-editor-demo/issues/302) (phases #303–#308, #313)  
Supersedes: ADR 0002 (the AWS-native serverless backend). ADR 0001 remains law
for the file vault workflow, and Gitea remains the only datastore.

## Why This Exists

Two problems needed one decision.

**Configuration drift.** The production host was configured by hand: SSH in,
edit files, restart containers. Adding a config file meant editing an EC2
bootstrap script (`infra/compute/user-data.sh.tftpl`) or pushing to an S3
config bucket (`infra/config-bucket/`), so Terraform owned both
infrastructure-as-code and configuration-as-code. What ran on the host and what
was in version control diverged, and a rebuilt host was not reproducible.

**A half-built serverless stack.** ADR 0002 planned an AWS-native backend
(Cognito + DynamoDB + S3 + Lambda). What actually got built was a partial
migration — Lambda + Aurora + API Gateway, plus a hack that routed the Lambda's
egress through the Gitea EC2 instance acting as a NAT — while the product kept
running on Gitea per ADR 0001. That left two backends to reason about, an Aurora
cluster billing continuously pre-launch, and a networking dependency between two
things that should not know about each other. The premise of ADR 0002 (drop the
self-hosted Gitea dependency) never came true, so its operational model was
paying costs without delivering its benefit.

## Decision

**Run the whole backend on one EC2 host, and deploy to it by pushing with
pyinfra from GitHub Actions.**

1. **One host.** Gitea, the API BFF, Hocuspocus, Caddy, and the Litestream
   backup sidecar all run as Docker Compose services on a single EC2 instance.
   API sessions are SQLite on the EBS data volume (`services/api/sessions.ts`),
   not Aurora.

2. **`deploy/` is the deployment.** `deploy/deploy.py` is a pyinfra script that
   defines the host end to end: install Docker, mount the data volume, upload
   `deploy/files/` runtime config, render `/opt/bindersnap/.env.prod` from SSM
   Parameter Store, bootstrap the Gitea service token on first run, and bring
   the compose stack up. It is idempotent — a re-run with no changes changes
   nothing, and a fresh host converges to today's stack with no
   pre-configuration.

3. **Push, don't pull.** `.github/workflows/deploy-pyinfra.yml` runs pyinfra on
   every push to `main`. The host runs no deploy agent and polls nothing.

4. **SSH tunnelled over SSM.** The host keeps **no inbound port 22** and we
   store **no long-lived SSH or AWS keys**. Each run assumes the OIDC deploy
   role, resolves the instance by tag, pushes a ~60-second ephemeral key with
   EC2 Instance Connect, and dials SSH through `aws ssm start-session`
   (`AWS-StartSSHSession`) via a `ProxyCommand`.

5. **Terraform provisions; pyinfra configures.** Terraform owns only
   infrastructure: the instance, volumes, IAM, networking, backups, monitoring,
   secrets storage. `infra/compute/user-data.sh` does exactly one thing —
   confirm the SSM agent is running so pyinfra can reach a fresh host. No
   bootstrap script, no config bucket.

6. **Secrets stay in Parameter Store.** `deploy.py` reads `/bindersnap/prod/*`
   on the **control plane** (CI's OIDC role or the operator's credentials),
   holds the rendered env content in memory, and uploads `.env.prod` with `0600`
   perms. Nothing is written to a control-plane disk file, printed, or
   committed. The host needs no SSM read permissions of its own for this path.

7. **Deploys are pinned and reversible.** Each deploy pins `API_TAG` to the
   deployed commit's SHA (`ghcr.io/davidgraymi/bindersnap-api:<sha>`), never
   mutable `:latest`. Rollback is `git revert` plus the resulting deploy, or a
   `workflow_dispatch` run with an explicit `api_tag`.

## Consequences

Positive:

1. The full deployment definition is readable Python in version control.
   Adding a config file is a commit, not an infrastructure change.
2. A fresh host is reproducible. Disaster recovery is: Terraform apply, push to
   `main`, restore from Litestream.
3. One backend, one datastore, one bill. No Aurora, no API Gateway, no Lambda,
   no Gitea-as-NAT coupling.
4. No inbound SSH and no static credentials anywhere in the deploy path.
5. Terraform plans stop churning on configuration changes, because Terraform no
   longer knows about configuration.

Tradeoffs:

1. **Single host, single point of failure.** There is no redundancy and deploys
   have a brief restart window. Accepted for pre-launch: Litestream replicates
   both SQLite databases to S3 continuously, DLM snapshots the volume, and the
   break-glass runbook recovers over SSM. Revisit before we promise an SLA.
2. **Self-hosting is back on the bill of work** — patching, disk, and monitoring
   for one instance. This was ADR 0002's central objection; the counter is that
   the serverless alternative never removed Gitea, so it added the managed
   footprint on top of the self-hosted one rather than replacing it.
3. **Deploys need AWS reachability from CI.** If the OIDC role, SSM, or EC2
   Instance Connect is unavailable, the pipeline cannot deploy. The break-glass
   path is a direct SSM session (`docs/ops/break-glass.md`).
4. **pyinfra is a Python dependency in a Bun repo.** `deploy/` carries its own
   `requirements.txt` and venv. Accepted: the deployment tool does not need to
   match the application runtime.

## Alternatives Considered

| Alternative                                | Why not                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Finish the ADR 0002 serverless build       | Would have meant rewriting the entire Gitea-backed data layer. Cost and rewrite scope are wrong for a pre-launch solo team. |
| Keep bootstrapping via Terraform user-data | Config changes require replacing the instance, and user-data runs only at first boot — the drift problem stays.             |
| Ansible                                    | Same push model, heavier install and YAML indirection. pyinfra gives the same operations as plain Python.                   |
| SSM `send-command` deploy scripts          | What we had. Deploy logic ends up as shell embedded in a workflow, with no dry run and no change detection.                 |
| A pull agent on the host                   | Needs an agent to keep alive and patch, and inverts the audit trail — CI would no longer know whether a deploy landed.      |

## Teardown

The serverless _code_ (`infra/api-service/`, `deploy-api.yml`, the Lambda/NAT
coupling) was removed in phase 5 ([#307](https://github.com/davidgraymi/bindersnap-editor-demo/issues/307)).
The owner runs `terraform destroy` on `infra/api-service` manually. Aurora held
no data needing preservation — the product is pre-launch and sessions moved back
to SQLite.

## Where to Look

- `deploy/README.md` — how the connection and the deploy script work
- `docs/ops/deploy.md` — the pipeline, required GitHub variables, rollback
- `docs/ops/break-glass.md` — recovering the host without CI
