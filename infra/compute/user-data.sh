#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bindersnap}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.prod}"
PARAMETER_PATH="${SSM_PARAMETER_PATH:-/bindersnap/prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

install -d -m 0755 "${APP_DIR}"

cat >/usr/local/bin/bindersnap-refresh-env <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bindersnap}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.prod}"
PARAMETER_PATH="${SSM_PARAMETER_PATH:-/bindersnap/prod}"
TMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
JSON_FILE="$(mktemp "${ENV_FILE}.json.XXXXXX")"

cleanup() {
  rm -f "${TMP_FILE}" "${JSON_FILE}"
}

trap cleanup EXIT
umask 077

aws ssm get-parameters-by-path \
  --path "${PARAMETER_PATH}" \
  --recursive \
  --with-decryption \
  --output json \
  >"${JSON_FILE}"

python3 -c '
import json
import sys

prefix = sys.argv[1].rstrip("/")
payload = json.load(sys.stdin)
parameters = sorted(payload.get("Parameters", []), key=lambda item: item["Name"])

if not parameters:
    raise SystemExit(f"No SSM parameters found under {prefix}")

for item in parameters:
    name = item["Name"]
    if not name.startswith(prefix + "/"):
        continue
    value = item["Value"]
    if "\n" in value:
        raise SystemExit(f"{name} contains a newline and cannot be written to a Docker env file")
    env_name = name.rsplit("/", 1)[-1].replace("-", "_").upper()
    print(f"{env_name}={value}")
' "${PARAMETER_PATH}" <"${JSON_FILE}" >"${TMP_FILE}"

install -d -m 0755 "${APP_DIR}"
install -m 0600 "${TMP_FILE}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
if [ "$(id -u)" -eq 0 ]; then
  chown root:root "${ENV_FILE}"
fi
SCRIPT

chmod 0755 /usr/local/bin/bindersnap-refresh-env

cat >/etc/systemd/system/bindersnap-refresh-env.service <<SERVICE
[Unit]
Description=Refresh Bindersnap env file from SSM Parameter Store
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_DIR=${APP_DIR}
Environment=ENV_FILE=${ENV_FILE}
Environment=SSM_PARAMETER_PATH=${PARAMETER_PATH}
ExecStart=/usr/local/bin/bindersnap-refresh-env

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/bindersnap-compose.service <<SERVICE
[Unit]
Description=Start the Bindersnap production Docker Compose stack
ConditionPathExists=${APP_DIR}/${COMPOSE_FILE}
After=network-online.target docker.service bindersnap-refresh-env.service
Requires=docker.service bindersnap-refresh-env.service
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
ExecStart=/bin/sh -lc 'docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d'
ExecReload=/bin/sh -lc 'docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now bindersnap-refresh-env.service
systemctl enable --now bindersnap-compose.service
