"""Bindersnap production deployment (epic #302, phase #304).

Ports every step the old `infra/compute/user-data.sh.tftpl` bootstrap and the S3
config sync used to perform into idempotent pyinfra operations. A full run
against a fresh host reproduces today's running Docker Compose stack; re-running
is a no-op unless config or secrets actually changed.

Pipeline (top to bottom — pyinfra runs operations in definition order):

  1. install Docker, the AWS CLI and XFS tooling
  2. install the Docker Compose plugin (arch-matched)
  3. format + mount the EBS data volume and point Docker's data-root at it
  4. start + enable Docker on the prepared storage
  5. upload the runtime config (compose / Caddy / litestream / Dockerfile) and
     the host helper scripts
  6. refresh `/opt/bindersnap/.env.prod` from SSM Parameter Store
  7. log in to GHCR (when a token is present) and bootstrap the Gitea service
     token on first run
  8. `docker compose up -d`, force-recreating only when this run changed env or
     config

Secrets never touch the repo: they live in SSM and land in `.env.prod` (0600)
on the host at deploy time. The connection itself is SSH-over-SSM (see
`inventory.py`).
"""

import os

from pyinfra import config, host
from pyinfra.facts.server import Arch
from pyinfra.operations import dnf, files, server, systemd

# Every operation needs root on the host; the deploy user (ec2-user) has
# passwordless sudo on AL2023.
config.SUDO = True

# ---------- Paths and constants ----------

APP_DIR = "/opt/bindersnap"
ENV_FILE = f"{APP_DIR}/.env.prod"
COMPOSE_FILE = "docker-compose.prod.yml"
STATE_DIR = "/run/bindersnap"
BIN_DIR = "/usr/local/bin"

SSM_PARAMETER_PATH = os.environ.get("BINDERSNAP_SSM_PARAMETER_PATH", "/bindersnap/prod")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Docker Compose plugin: pinned to match the version the old user-data installed.
COMPOSE_VERSION = "v2.37.3"
COMPOSE_PLUGIN_DIR = "/usr/local/lib/docker/cli-plugins"
COMPOSE_PLUGIN_PATH = f"{COMPOSE_PLUGIN_DIR}/docker-compose"

# Local source tree: `deploy/files/` is the single source of truth for the host.
_FILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "files")
_BIN = os.path.join(_FILES, "bin")
_SCRIPTS = os.path.join(_FILES, "scripts")

# Runtime config files uploaded to APP_DIR. Changing any of these flags the
# stack for a force-recreate (mirrors the file set the old refresh timer hashed).
CONFIG_FILES = [
    "docker-compose.prod.yml",
    "Caddyfile.prod",
    "litestream.yml",
    "Dockerfile.caddy",
]

# Host helper scripts uploaded to BIN_DIR (ported from user-data.sh.tftpl).
HELPER_SCRIPTS = [
    "bindersnap-setup-storage",
    "bindersnap-refresh-env",
    "bindersnap-ghcr-login",
    "bindersnap-bootstrap-gitea",
    "bindersnap-stack-up",
]


# ---------- 1. System packages ----------

dnf.packages(
    name="Install Docker, AWS CLI and XFS tooling",
    packages=["docker", "awscli", "xfsprogs"],
    update=True,
)

# ---------- 2. Docker Compose plugin (arch-matched) ----------

# AL2023 runs on arm64 AMIs (uname -m == aarch64); the release assets are named
# docker-compose-linux-<aarch64|x86_64>. The Arch fact resolves at connect time
# so the same deploy works on x86 hosts too.
_arch = host.get_fact(Arch)

files.directory(
    name="Ensure Docker CLI plugin dir",
    path=COMPOSE_PLUGIN_DIR,
    mode="0755",
)

files.download(
    name="Install the Docker Compose plugin",
    src=(
        "https://github.com/docker/compose/releases/download/"
        f"{COMPOSE_VERSION}/docker-compose-linux-{_arch}"
    ),
    dest=COMPOSE_PLUGIN_PATH,
    mode="0755",
)

# ---------- 3. EBS data volume + Docker data-root ----------

files.directory(name="Ensure app dir", path=APP_DIR, mode="0755")
files.directory(name="Ensure app scripts dir", path=f"{APP_DIR}/scripts", mode="0755")

for _script in HELPER_SCRIPTS:
    files.put(
        name=f"Upload {_script}",
        src=os.path.join(_BIN, _script),
        dest=f"{BIN_DIR}/{_script}",
        mode="0755",
    )

server.shell(
    name="Mount data volume + set Docker data-root",
    commands=[f"{BIN_DIR}/bindersnap-setup-storage"],
)

# ---------- 4. Start Docker on the prepared storage ----------

systemd.service(
    name="Enable + start Docker",
    service="docker",
    running=True,
    enabled=True,
)

# ---------- 5. Upload runtime config + app scripts ----------

config_uploads = [
    files.put(
        name=f"Upload {_name}",
        src=os.path.join(_FILES, _name),
        dest=f"{APP_DIR}/{_name}",
        mode="0644",
    )
    for _name in CONFIG_FILES
]

# The Gitea bootstrap mints its token by running this script inside a bun
# container mounted at APP_DIR, so it must live under APP_DIR/scripts.
files.put(
    name="Upload Gitea bootstrap script",
    src=os.path.join(_SCRIPTS, "bootstrap-gitea-service-account.ts"),
    dest=f"{APP_DIR}/scripts/bootstrap-gitea-service-account.ts",
    mode="0644",
)

# The bindersnap host CLI ships alongside the config and is installed onto PATH.
files.put(
    name="Upload bindersnap host CLI",
    src=os.path.join(_SCRIPTS, "bindersnap"),
    dest=f"{APP_DIR}/scripts/bindersnap",
    mode="0755",
)
files.put(
    name="Install bindersnap host CLI on PATH",
    src=os.path.join(_SCRIPTS, "bindersnap"),
    dest=f"{BIN_DIR}/bindersnap",
    mode="0755",
)

# ---------- 6. Change detection: reset markers + flag config changes ----------

files.directory(name="Ensure state dir", path=STATE_DIR, mode="0755")
files.file(
    name="Reset config-changed marker",
    path=f"{STATE_DIR}/config-changed",
    present=False,
)

for _upload in config_uploads:
    server.shell(
        name="Flag config change for recreate",
        commands=[f"touch {STATE_DIR}/config-changed"],
        _if=_upload.did_change,
    )

# Snapshot the env-file hash before the SSM refresh rewrites it, so the stack-up
# script can tell whether secrets actually changed.
server.shell(
    name="Snapshot env-file hash",
    commands=[
        f"mkdir -p {STATE_DIR}",
        (
            f"(sha256sum {ENV_FILE} 2>/dev/null | awk '{{print $1}}') "
            f"> {STATE_DIR}/env-before || true; "
            f"[ -s {STATE_DIR}/env-before ] || echo none > {STATE_DIR}/env-before"
        ),
    ],
)

# ---------- 7. Secrets, registry login, Gitea bootstrap ----------

server.shell(
    name="Refresh .env.prod from SSM Parameter Store",
    commands=[f"{BIN_DIR}/bindersnap-refresh-env"],
    _env={"SSM_PARAMETER_PATH": SSM_PARAMETER_PATH, "AWS_REGION": AWS_REGION},
)

server.shell(
    name="Log in to GHCR when a token is present",
    commands=[f"{BIN_DIR}/bindersnap-ghcr-login"],
)

server.shell(
    name="Bootstrap the Gitea service token (first run only)",
    commands=[f"{BIN_DIR}/bindersnap-bootstrap-gitea"],
    _env={"SSM_PARAMETER_PATH": SSM_PARAMETER_PATH, "AWS_REGION": AWS_REGION},
)

# ---------- 8. Bring the stack up (recreate only on change) ----------

server.shell(
    name="Compose up (force-recreate only when changed)",
    commands=[f"{BIN_DIR}/bindersnap-stack-up"],
)
