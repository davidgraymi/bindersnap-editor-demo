# `deploy/` — pyinfra push deployment

This directory is the single source of truth for how the Bindersnap production
host is configured and how the application is deployed. It replaces the old
flow (manual SSH, `infra/compute/user-data.sh.tftpl` bootstrap, and the S3
config bucket). See epic
[#302](https://github.com/davidgraymi/bindersnap-editor-demo/issues/302).

> **Status:** Phase 2 — `deploy.py` performs the full host configuration and the
> runtime config now lives in `deploy/files/`. The GitHub Actions workflow that
> runs this on every push to `main` arrives in Phase 3
> ([#305](https://github.com/davidgraymi/bindersnap-editor-demo/issues/305)).

## How it connects

pyinfra drives the host from the outside over SSH — but the host keeps **no
inbound port 22** and we store **no long-lived keys**. Every run:

1. resolves the running instance by tag (`Project=bindersnap`);
2. generates a throwaway ed25519 keypair and a matching SSH config;
3. pushes the public key to the host with **EC2 Instance Connect** (valid ~60s);
4. opens SSH **tunnelled through AWS SSM** via a `ProxyCommand` in that config
   (`aws ssm start-session` with the `AWS-StartSSHSession` document), which
   pyinfra parses and dials lazily at connect time.

`deploy/bin/ssm-connect.sh` orchestrates 1–3 and then runs pyinfra;
`deploy/inventory.py` references the generated config so pyinfra dials it.

## Layout

| Path                 | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `inventory.py`       | Single prod host + SSH-over-SSM connection data         |
| `deploy.py`          | The deployment itself (operations run against the host) |
| `files/`             | Runtime config uploaded to the host (was `config/`)     |
| `files/bin/`         | Host helper scripts (ported from `user-data.sh.tftpl`)  |
| `files/scripts/`     | App scripts: `bindersnap` CLI + Gitea bootstrap         |
| `bin/ssm-connect.sh` | Resolve instance, push ephemeral key, invoke pyinfra    |
| `requirements.txt`   | Python toolchain (pyinfra, paramiko)                    |

## What `deploy.py` does

Each run is idempotent — a fresh host ends up running today's Docker Compose
stack, and a re-run changes nothing unless config or secrets actually changed:

1. install Docker, the AWS CLI and XFS tooling, plus the Compose plugin;
2. format + mount the EBS data volume and point Docker's `data-root` at it;
3. upload `files/` config and the `files/bin/` helper scripts to the host;
4. render `/opt/bindersnap/.env.prod` (`0600`) from SSM Parameter Store — the
   SSM read happens on the control plane (boto3) and the file is uploaded with
   `files.put`, so pyinfra's change detection drives the recreate decision;
5. log in to GHCR (if a token is present) and bootstrap the Gitea service token
   on first run;
6. `docker compose up -d`, force-recreating **only** when this run changed the
   env file or a config file.

## Prerequisites

- AWS CLI v2 and the `session-manager-plugin` on `PATH`
- Python 3 + the deps in `requirements.txt`
- AWS credentials (locally a profile; in CI the OIDC deploy role) able to:
  - `ec2:DescribeInstances`
  - `ec2-instance-connect:SendSSHPublicKey`
  - `ssm:StartSession` on the `AWS-StartSSHSession` document and the instance

> The OIDC deploy role does **not** yet grant `StartSession` /
> `SendSSHPublicKey` — those IAM additions land with the CI workflow in Phase 3
> ([#305](https://github.com/davidgraymi/bindersnap-editor-demo/issues/305)).
> Until then, run locally with a profile that has them.

## Usage

```bash
# one-time
python3 -m venv deploy/.venv
deploy/.venv/bin/pip install -r deploy/requirements.txt
source deploy/.venv/bin/activate

# connectivity check (Phase 1)
deploy/bin/ssm-connect.sh

# dry run (no changes applied)
deploy/bin/ssm-connect.sh --dry
```

Override defaults with env vars: `AWS_REGION`, `BINDERSNAP_INSTANCE_ID`
(skip tag lookup), `BINDERSNAP_SSH_USER`, `BINDERSNAP_INSTANCE_TAG_KEY`,
`BINDERSNAP_INSTANCE_TAG_VALUE`.

## Security notes

- No SSH key material is ever written to the repo (`.gitignore` enforces this).
- Secrets continue to live in AWS Parameter Store. `deploy.py` reads them on the
  control plane (CI's OIDC role / the operator's AWS creds), holds the rendered
  env content in memory, and uploads `/opt/bindersnap/.env.prod` with `0600`
  perms. They are never written to a control-plane disk file, printed, or
  committed.
