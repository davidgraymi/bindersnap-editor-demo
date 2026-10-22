# AGENTS.md — production configuration (`deploy/`)

Read with the root `AGENTS.md` (decision 6: `deploy/` configures the host;
Terraform does not) and `deploy/README.md`.

## How a production deploy runs

On every push to `main`,
`deploy-pyinfra.yml` runs the unit suites, builds and pushes
`ghcr.io/davidgraymi/bindersnap-api:<sha>`, assumes the OIDC deploy role, then
runs `deploy/bin/ssm-connect.sh`. That script resolves the instance by tag,
pushes a ~60-second ephemeral key with EC2 Instance Connect, tunnels SSH through
`aws ssm start-session`, and runs `pyinfra deploy/inventory.py deploy/deploy.py`.
**There is no inbound port 22 and no long-lived key material anywhere in this
path.** `deploy.py` is idempotent: it installs Docker, mounts the EBS volume,
uploads `deploy/files/`, renders `/opt/bindersnap/.env.prod` from SSM Parameter
Store, and force-recreates the stack only when config or secrets actually
changed.

Rollback is `git revert` on `main` (the deploy re-applies the prior stack), or a
`workflow_dispatch` run with an explicit `api_tag`. Each deploy pins `API_TAG`
to the deployed commit's SHA — never mutable `:latest`.

## Production security rules

These apply to any change touching `deploy/`, `deploy/files/docker-compose.prod.yml`,
`deploy/files/Caddyfile.prod`, or EC2 deployment. The Gitea service-token rule
is in the root `AGENTS.md`, because it governs the API's code as well.

1. **Never hardcode credentials.** All secrets (`GITEA_ADMIN_PASS`, `GITEA_SECRET_KEY`, `BINDERSNAP_GITEA_SERVICE_TOKEN`, etc.) must come from environment variables in `/opt/bindersnap/.env.prod`, which `deploy.py` renders on every run from `/bindersnap/prod/*` in SSM Parameter Store. The SSM read happens on the control plane and the file is uploaded `0600` — secrets are never written to a control-plane disk file, printed, or committed. Never commit an `.env.prod`; it is in `.gitignore`.
2. **Registration is disabled in prod.** `GITEA__service__DISABLE_REGISTRATION=true` is non-negotiable for production. Dev compose may differ.
3. **`INSTALL_LOCK=true` in prod.** Prevents Gitea setup wizard from re-running after first boot.
4. **Rotate credentials on first deploy.** Generate with `openssl rand -base64 20` for passwords and `openssl rand -base64 32` for secret keys.
