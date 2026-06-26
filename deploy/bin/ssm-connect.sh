#!/usr/bin/env bash
#
# Connect to the Bindersnap production host and run pyinfra over an
# SSM-tunnelled SSH transport (epic #302). No inbound port 22, no long-lived
# SSH keys: we resolve the instance by tag, push an ephemeral key via EC2
# Instance Connect, then let paramiko tunnel SSH through Session Manager.
#
# Usage:
#   deploy/bin/ssm-connect.sh                 # apply deploy/deploy.py
#   deploy/bin/ssm-connect.sh --dry           # pyinfra dry run
#   deploy/bin/ssm-connect.sh fact server.Os  # any pyinfra args pass through
#
# Prerequisites (local or CI):
#   - aws CLI v2 + session-manager-plugin on PATH
#   - pyinfra installed (deploy/requirements.txt)
#   - AWS credentials with: ec2:DescribeInstances,
#     ec2-instance-connect:SendSSHPublicKey, ssm:StartSession on the
#     AWS-StartSSHSession document and the target instance.
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
SSH_USER="${BINDERSNAP_SSH_USER:-ec2-user}"
INSTANCE_TAG_KEY="${BINDERSNAP_INSTANCE_TAG_KEY:-Project}"
INSTANCE_TAG_VALUE="${BINDERSNAP_INSTANCE_TAG_VALUE:-bindersnap}"

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${deploy_dir}/.." && pwd)"

# 1. Resolve the running instance id (explicit override wins).
instance_id="${BINDERSNAP_INSTANCE_ID:-}"
if [ -z "${instance_id}" ]; then
  instance_id="$(aws ec2 describe-instances \
    --region "${AWS_REGION}" \
    --filters "Name=tag:${INSTANCE_TAG_KEY},Values=${INSTANCE_TAG_VALUE}" \
              "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].InstanceId | [0]' \
    --output text)"
fi
if [ -z "${instance_id}" ] || [ "${instance_id}" = "None" ]; then
  echo "ERROR: no running instance for ${INSTANCE_TAG_KEY}=${INSTANCE_TAG_VALUE} in ${AWS_REGION}" >&2
  exit 1
fi
echo "Target instance: ${instance_id}"

# 2. Ephemeral keypair + SSH config, removed on exit.
keydir="$(mktemp -d)"
trap 'rm -rf "${keydir}"' EXIT
ssh-keygen -t ed25519 -N "" -f "${keydir}/id" -q -C "bindersnap-deploy"

# SSH config whose ProxyCommand tunnels the transport through Session Manager.
# %h/%p expand to the instance id and port pyinfra connects to.
cat >"${keydir}/ssh_config" <<SSH_CONFIG
Host *
    User ${SSH_USER}
    IdentityFile ${keydir}/id
    StrictHostKeyChecking accept-new
    UserKnownHostsFile /dev/null
    ProxyCommand sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p --region ${AWS_REGION}"
SSH_CONFIG

# 3. Push the public key (~60s validity) via EC2 Instance Connect.
az="$(aws ec2 describe-instances \
  --region "${AWS_REGION}" \
  --instance-ids "${instance_id}" \
  --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' \
  --output text)"
aws ec2-instance-connect send-ssh-public-key \
  --region "${AWS_REGION}" \
  --instance-id "${instance_id}" \
  --availability-zone "${az}" \
  --instance-os-user "${SSH_USER}" \
  --ssh-public-key "file://${keydir}/id.pub" >/dev/null
echo "Pushed ephemeral key for ${SSH_USER}@${instance_id}"

# 4. Run pyinfra. inventory.py reads the exported variables below.
export BINDERSNAP_INSTANCE_ID="${instance_id}"
export BINDERSNAP_SSH_KEY="${keydir}/id"
export BINDERSNAP_SSH_CONFIG="${keydir}/ssh_config"
export BINDERSNAP_SSH_USER="${SSH_USER}"
export AWS_REGION

cd "${repo_root}"
exec pyinfra deploy/inventory.py deploy/deploy.py "$@"
