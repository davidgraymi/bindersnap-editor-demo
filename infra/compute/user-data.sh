#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bindersnap}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.prod}"
PARAMETER_PATH="${SSM_PARAMETER_PATH:-/bindersnap/prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

install -d -m 0755 "${APP_DIR}"

# --- CloudWatch Agent (disk + memory metrics) ---
if ! command -v amazon-cloudwatch-agent-ctl &>/dev/null; then
  yum install -y amazon-cloudwatch-agent 2>/dev/null || dnf install -y amazon-cloudwatch-agent 2>/dev/null || true
fi

if command -v amazon-cloudwatch-agent-ctl &>/dev/null; then
  install -m 0644 /dev/stdin /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'CW_CONFIG'
{
  "agent": { "metrics_collection_interval": 300 },
  "metrics": {
    "namespace": "Bindersnap",
    "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
    "metrics_collected": {
      "disk": {
        "measurement": ["used_percent"],
        "metrics_collection_interval": 300,
        "resources": ["/", "/data"],
        "ignore_file_system_types": ["sysfs", "devtmpfs", "tmpfs", "squashfs", "overlay"]
      },
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 300
      }
    }
  }
}
CW_CONFIG
  amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s
fi

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

# Timer: re-fetch secrets every 6 hours and restart compose if the env file changed.
# Catches rotated secrets without a reboot. Also triggerable manually:
#   systemctl start bindersnap-refresh-and-restart.service
cat >/etc/systemd/system/bindersnap-refresh-and-restart.service <<SERVICE
[Unit]
Description=Refresh SSM secrets and restart Bindersnap if env changed
After=network-online.target docker.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_DIR=${APP_DIR}
Environment=ENV_FILE=${ENV_FILE}
Environment=SSM_PARAMETER_PATH=${PARAMETER_PATH}
ExecStart=/bin/bash -c '\
  BEFORE=\$(sha256sum "\${ENV_FILE}" 2>/dev/null || echo "none"); \
  /usr/local/bin/bindersnap-refresh-env; \
  AFTER=\$(sha256sum "\${ENV_FILE}"); \
  if [ "\$BEFORE" != "\$AFTER" ]; then \
    echo "Env file changed — restarting compose stack"; \
    cd ${APP_DIR} && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d; \
  else \
    echo "Env file unchanged — no restart needed"; \
  fi'
SERVICE

cat >/etc/systemd/system/bindersnap-refresh-and-restart.timer <<TIMER
[Unit]
Description=Periodic SSM secret refresh for Bindersnap

[Timer]
OnCalendar=*-*-* 00/6:00:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
TIMER

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
systemctl enable --now bindersnap-refresh-and-restart.timer
