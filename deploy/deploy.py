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
  6. render `/opt/bindersnap/.env.prod` from SSM Parameter Store (read on the
     control plane via boto3, uploaded with `files.put`)
  7. validate the compose config + custom Caddy build before any `up` (gate)
  8. log in to GHCR (when a token is present on the control plane) and bootstrap
     the Gitea service token on first run
  9. `docker compose up -d`, force-recreating only when this run changed env or
     config

Secrets never touch the repo: they live in SSM and land in `.env.prod` (0600)
on the host at deploy time. The connection itself is SSH-over-SSM (see
`inventory.py`).

Secret reads on the control plane: as of the Phase 2 follow-up the SSM read for
`.env.prod` happens here (in `deploy.py`) rather than on the host, so the env
file is rendered with `files.put` and pyinfra's `did_change` drives the
recreate decision for free. The trade-off — made deliberately — is that the SSM
read now uses the *control plane's* credentials (CI's OIDC role / the operator's
local AWS creds) instead of the host instance profile. The rendered content is
held in memory (an `io.StringIO`), never written to a control-plane disk file,
and lands on the host at `0600`.

GHCR credentials (GHCR_TOKEN / GHCR_USER) are read from the control-plane
environment at deploy time — in CI these come from GitHub Actions secrets; for
local runs, export them before invoking pyinfra. If GHCR_TOKEN is unset the
login step is skipped (public images only).
"""

import io
import os

import boto3

from pyinfra import config, host
from pyinfra.api import FactBase
from pyinfra.facts.server import Arch
from pyinfra.operations import dnf, docker, files, server, systemd

# Every operation needs root on the host; the deploy user (ec2-user) has
# passwordless sudo on AL2023.
config.SUDO = True

# ---------- Paths and constants ----------

APP_DIR = "/opt/bindersnap"
ENV_FILE = f"{APP_DIR}/.env.prod"
COMPOSE_FILE = "docker-compose.prod.yml"
STATE_DIR = "/run/bindersnap"
BIN_DIR = "/usr/local/bin"

DATA_LABEL = "bsnap-data"
DATA_MOUNT = "/data"

SSM_PARAMETER_PATH = os.environ.get("BINDERSNAP_SSM_PARAMETER_PATH", "/bindersnap/prod")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# While the Gitea service token has not been minted yet, SSM holds this sentinel
# instead of a real token. The bootstrap (first run) mints the real value; until
# then the admin bootstrap creds must stay in `.env.prod` so the mint can run.
BOOTSTRAP_TOKEN_PLACEHOLDER = "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"

# Docker Compose plugin: pinned to match the version the old user-data installed.
COMPOSE_VERSION = "v2.37.3"
COMPOSE_PLUGIN_DIR = "/usr/local/lib/docker/cli-plugins"
COMPOSE_PLUGIN_PATH = f"{COMPOSE_PLUGIN_DIR}/docker-compose"

# Local tag for the custom Caddy image built during the pre-`up` validation gate.
# Production Caddy uses the rate-limit module, so the Caddyfile can only be
# validated against the custom build, not the stock caddy image.
CADDY_VALIDATE_IMAGE = "bindersnap-caddy-validate:local"

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

# Host helper scripts uploaded to BIN_DIR.
# EBS storage setup, GHCR login and the SSM .env.prod render are now native
# pyinfra operations (DataDevice fact + server.mount, docker.login, and a
# control-plane boto3 read + files.put respectively) and are no longer deployed
# as host scripts.
HELPER_SCRIPTS = [
    "bindersnap-bootstrap-gitea",
    "bindersnap-stack-up",
]


# ---------- Control-plane SSM render ----------

def build_env_content(parameters: list[dict], parameter_path: str) -> str:
    """Render Docker `.env.prod` content from raw SSM parameters.

    Faithful port of the transform the old host-side refresh-env script
    performed: parameters are sorted by name, each leaf becomes an upper-snake
    env var, and the first-boot admin credentials are dropped once the Gitea
    service token is a real value (no longer the bootstrap placeholder). Values
    containing newlines are rejected — they cannot be expressed in a Docker env
    file.
    """
    prefix = parameter_path.rstrip("/")
    items = sorted(parameters, key=lambda item: item["Name"])
    if not items:
        raise SystemExit(f"No SSM parameters found under {prefix}")

    token_value = None
    for item in items:
        if item["Name"] == f"{prefix}/gitea_service_token":
            token_value = item["Value"]
            break

    lines = []
    for item in items:
        name = item["Name"]
        if not name.startswith(prefix + "/"):
            continue
        value = item["Value"]
        if "\n" in value:
            raise SystemExit(
                f"{name} contains a newline and cannot be written to a Docker env file"
            )
        env_name = name.rsplit("/", 1)[-1].replace("-", "_").upper()
        if (
            token_value
            and token_value != BOOTSTRAP_TOKEN_PLACEHOLDER
            and env_name in {"GITEA_ADMIN_USER", "GITEA_ADMIN_PASS"}
        ):
            continue
        lines.append(f"{env_name}={value}")

    return "\n".join(lines) + "\n"


def render_env_file() -> str:
    """Read the SSM Parameter Store tree on the control plane and render env content."""
    client = boto3.client("ssm", region_name=AWS_REGION)
    paginator = client.get_paginator("get_parameters_by_path")
    parameters: list[dict] = []
    for page in paginator.paginate(
        Path=SSM_PARAMETER_PATH,
        Recursive=True,
        WithDecryption=True,
    ):
        parameters.extend(page.get("Parameters", []))
    return build_env_content(parameters, SSM_PARAMETER_PATH)


# ---------- Custom facts ----------

class DataDevice(FactBase[str]):
    """Path of the non-root NVMe block device, or empty string if none found.

    The EBS data volume is attached by Terraform before the deploy runs
    (immutable during the run), so reading this at prepare time is safe.
    """

    command = (
        "for dev in /dev/nvme?n1; do"
        "  [ -b \"$dev\" ] || continue;"
        "  root=$(lsblk -ndo PKNAME $(findmnt -n -o SOURCE /) 2>/dev/null || true);"
        "  [ \"$(basename $dev)\" = \"$root\" ] && continue;"
        "  printf '%s' \"$dev\"; break;"
        "done"
    )

    def process(self, output: list[str]) -> str:
        return "".join(output).strip()


class BlockDeviceFilesystem(FactBase[str]):
    """Filesystem type on a block device (empty string if unformatted).

    Safe at prepare time because nothing earlier in the same run can format
    the volume before facts are gathered.
    """

    def command(self, device: str) -> str:
        return f"blkid -o value -s TYPE {device} 2>/dev/null || true"

    def process(self, output: list[str]) -> str:
        return "".join(output).strip()


class ComposePluginVersion(FactBase[str]):
    """Installed Docker Compose plugin version (e.g. ``v2.37.3``), '' if absent.

    Normalised with a leading ``v`` so it can be compared directly against
    ``COMPOSE_VERSION``. ``files.download`` is idempotent only on the file's
    existence, so without this gate a bump of ``COMPOSE_VERSION`` would never
    re-install — the pin would be silently ineffective on upgrades.
    """

    def command(self, path: str) -> str:
        return f"{path} version --short 2>/dev/null || true"

    def process(self, output: list[str]) -> str:
        version = "".join(output).strip()
        if version and not version.startswith("v"):
            version = f"v{version}"
        return version


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

# files.download only checks whether the destination exists, so gate it on the
# installed version: this re-installs when COMPOSE_VERSION is bumped and is a
# no-op once the pinned version is in place.
if host.get_fact(ComposePluginVersion, COMPOSE_PLUGIN_PATH) != COMPOSE_VERSION:
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

# Detect the non-root NVMe block device at prepare time. The EBS volume is
# attached by Terraform before pyinfra runs so the device path is stable.
_data_device = host.get_fact(DataDevice)

if _data_device:
    # Format on first run only — safe because no earlier operation formats
    # this volume, so the filesystem-type fact reflects the true pre-deploy state.
    _data_fs = host.get_fact(BlockDeviceFilesystem, _data_device)
    if not _data_fs:
        server.shell(
            name="Format EBS data volume with XFS",
            commands=[f"mkfs.xfs -L {DATA_LABEL} {_data_device}"],
        )

    files.directory(name="Ensure data mount point", path=DATA_MOUNT, mode="0755")

    server.mount(
        name="Mount EBS data volume",
        path=DATA_MOUNT,
        device=f"LABEL={DATA_LABEL}",
        mounted=True,
        options=["defaults", "nofail"],
        fs_type="xfs",
    )

    # fstab: server.mount does not write fstab; use files.line for idempotent entry.
    files.line(
        name="Add data volume to fstab",
        path="/etc/fstab",
        line=f"LABEL={DATA_LABEL}",
        replace=f"LABEL={DATA_LABEL} {DATA_MOUNT} xfs defaults,nofail 0 2",
        ensure_newline=True,
    )

    files.directory(
        name="Ensure Docker data dir on EBS",
        path=f"{DATA_MOUNT}/docker",
        mode="0755",
    )

    files.directory(name="Ensure /etc/docker exists", path="/etc/docker", mode="0755")

    daemon_put = files.put(
        name="Write Docker daemon.json (data-root on EBS)",
        src=os.path.join(_FILES, "daemon.json"),
        dest="/etc/docker/daemon.json",
        mode="0644",
    )

    # Restart Docker only when the daemon config actually changed, replacing the
    # hand-rolled hash compare in the old storage-setup shell script.
    systemd.service(
        name="Restart Docker after daemon config change",
        service="docker",
        restarted=True,
        _if=daemon_put.did_change,
    )
else:
    server.shell(
        name="Warn: EBS data volume not found — Docker will use root volume",
        commands=[
            "echo 'WARNING: EBS data volume not found"
            " — Docker will use the root volume' >&2"
        ],
    )

# ---------- 4. Start Docker on the prepared storage ----------

systemd.service(
    name="Enable + start Docker",
    service="docker",
    running=True,
    enabled=True,
)

# ---------- 5. Upload runtime config + app scripts ----------

config_uploads = {
    _name: files.put(
        name=f"Upload {_name}",
        src=os.path.join(_FILES, _name),
        dest=f"{APP_DIR}/{_name}",
        mode="0644",
    )
    for _name in CONFIG_FILES
}

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

# ---------- 6. Render .env.prod from SSM (control plane) ----------

# Read the SSM tree here on the control plane and upload the rendered env file.
# `files.put` of an in-memory buffer keeps the secrets off the control-plane
# disk, lands them at 0600 on the host, and gives change detection for free:
# `env_put.did_change` is the single signal for "secrets changed this run".
env_put = files.put(
    name="Render .env.prod from SSM Parameter Store",
    src=io.StringIO(render_env_file()),
    dest=ENV_FILE,
    mode="0600",
    add_deploy_dir=False,
)

# ---------- 7. Change detection: reset markers + flag config/env changes ----------

# stack-up recreates the stack when either a config file or the env file changed
# this run. pyinfra signals both through marker files dropped via `_if`, which is
# delayed to execute time (unlike a prepare-time `if op.changed:`).
files.directory(name="Ensure state dir", path=STATE_DIR, mode="0755")
files.file(
    name="Reset config-changed marker",
    path=f"{STATE_DIR}/config-changed",
    present=False,
)
files.file(
    name="Reset env-changed marker",
    path=f"{STATE_DIR}/env-changed",
    present=False,
)

for _upload in config_uploads.values():
    server.shell(
        name="Flag config change for recreate",
        commands=[f"touch {STATE_DIR}/config-changed"],
        _if=_upload.did_change,
    )

server.shell(
    name="Flag env change for recreate",
    commands=[f"touch {STATE_DIR}/env-changed"],
    _if=env_put.did_change,
)

# ---------- 8. Validate config before any compose up ----------

# Pre-`up` gate: abort the deploy before touching the running stack if the
# compose file (interpolated with the rendered env) or the custom Caddy build is
# invalid. Folds in the checks the retiring `bindersnap stack validate` host CLI
# performed — deploy.py shipped no config validation before this. Runs after the
# env + config are on the host and Docker is up, but before the first `up` (which
# happens in the Gitea bootstrap below on a first run).
#
# Each half is gated on `did_change` of exactly its inputs: an unchanged deploy
# skips the gate because the running config was already validated on the run that
# last changed it (and on a first run everything changed, so it always runs). The
# Caddy half in particular is a full image build + container run, so skipping it
# when neither the Dockerfile nor the Caddyfile moved avoids that work every run.
server.shell(
    name="Validate compose config",
    commands=[
        f"cd {APP_DIR} && docker compose --env-file {ENV_FILE} "
        f"-f {COMPOSE_FILE} config -q",
    ],
    _if=lambda: config_uploads[COMPOSE_FILE].did_change() or env_put.did_change(),
)

server.shell(
    name="Validate custom Caddy build",
    commands=[
        f"docker build -q -t {CADDY_VALIDATE_IMAGE} "
        f"-f {APP_DIR}/Dockerfile.caddy {APP_DIR}",
        f"docker run --rm -v {APP_DIR}/Caddyfile.prod:/etc/caddy/Caddyfile:ro "
        f"{CADDY_VALIDATE_IMAGE} caddy validate --config /etc/caddy/Caddyfile",
    ],
    _if=lambda: (
        config_uploads["Dockerfile.caddy"].did_change()
        or config_uploads["Caddyfile.prod"].did_change()
    ),
)

# ---------- 9. Registry login + Gitea bootstrap ----------

# GHCR credentials are supplied by the control plane (CI secret / local env var).
# Native docker.login is idempotent: a no-op when the auth entry is already present.
_ghcr_token = os.environ.get("GHCR_TOKEN", "")
_ghcr_user = os.environ.get("GHCR_USER", "davidgraymi")
if _ghcr_token:
    docker.login(
        name="Log in to GHCR",
        server="ghcr.io",
        username=_ghcr_user,
        password=_ghcr_token,
    )

# First run only: the bootstrap reads the placeholder token from the env file
# rendered above, mints the real token, stores it back in SSM, and persists it
# into .env.prod itself (refresh-env is no longer a host script). On every later
# run the token is already real and the script exits early.
server.shell(
    name="Bootstrap the Gitea service token (first run only)",
    commands=[f"{BIN_DIR}/bindersnap-bootstrap-gitea"],
    _env={"SSM_PARAMETER_PATH": SSM_PARAMETER_PATH, "AWS_REGION": AWS_REGION},
)

# ---------- 10. Bring the stack up (recreate only on change) ----------

server.shell(
    name="Compose up (force-recreate only when changed)",
    commands=[f"{BIN_DIR}/bindersnap-stack-up"],
)
