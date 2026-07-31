"""Pure `.env.prod` render logic (epic #302, phase #304).

Extracted from `deploy.py` so it carries **no import-time side effects** — no
pyinfra operation graph, no boto3 client, no SSM read. `deploy.py` imports from
here for the live render; the unit tests import it in isolation.
"""

# While the Gitea service token has not been minted yet, SSM holds this sentinel
# instead of a real token. The bootstrap (first run) mints the real value; until
# then the admin bootstrap creds must stay in `.env.prod` so the mint can run.
BOOTSTRAP_TOKEN_PLACEHOLDER = "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"


def build_env_content(
    parameters: list[dict], parameter_path: str, api_tag: str | None = None
) -> str:
    """Render Docker `.env.prod` content from raw SSM parameters.

    Faithful port of the transform the old host-side refresh-env script
    performed: parameters are sorted by name, each leaf becomes an upper-snake
    env var, and the first-boot admin credentials are dropped once the Gitea
    service token is a real value (no longer the bootstrap placeholder). Values
    containing newlines are rejected — they cannot be expressed in a Docker env
    file.

    ``api_tag`` is the immutable API image tag the deploy wants to pin (issue
    #313 — the commit SHA in CI, so ``docker-compose.prod.yml`` runs
    ``bindersnap-api:<sha>`` instead of mutable ``:latest``). It is emitted as
    an ``API_TAG`` line **only when SSM does not already carry an ``api_tag``
    leaf**: a manually-set ``/bindersnap/prod/api_tag`` is the break-glass
    permanent-pin / rollback lever (see ``docs/ops/break-glass.md``) and must
    win over the per-deploy default so a pinned rollback survives redeploys.
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
    has_ssm_api_tag = False
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
        if env_name == "API_TAG":
            has_ssm_api_tag = True
        if (
            token_value
            and token_value != BOOTSTRAP_TOKEN_PLACEHOLDER
            and env_name in {"GITEA_ADMIN_USER", "GITEA_ADMIN_PASS"}
        ):
            continue
        lines.append(f"{env_name}={value}")

    # Pin the per-deploy image tag unless SSM already pins one (the break-glass
    # override). "\n" in a tag can't be expressed in a Docker env file.
    if api_tag and not has_ssm_api_tag:
        if "\n" in api_tag:
            raise SystemExit("api_tag contains a newline and cannot be pinned")
        lines.append(f"API_TAG={api_tag}")

    return "\n".join(lines) + "\n"
