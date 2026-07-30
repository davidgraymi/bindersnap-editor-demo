"""Pure `.env.prod` render logic (epic #302, phase #304).

Extracted from `deploy.py` so it carries **no import-time side effects** — no
pyinfra operation graph, no boto3 client, no SSM read. `deploy.py` imports from
here for the live render; the unit tests import it in isolation.
"""

# While the Gitea service token has not been minted yet, SSM holds this sentinel
# instead of a real token. The bootstrap (first run) mints the real value; until
# then the admin bootstrap creds must stay in `.env.prod` so the mint can run.
BOOTSTRAP_TOKEN_PLACEHOLDER = "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"


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
