#!/usr/bin/env bash
set -euo pipefail

# Terraform provisions infrastructure only (epic #302, phase 4 / #306).
# All host configuration — Docker, the EBS mount, runtime config, secrets,
# the CloudWatch agent, and the compose stack — is owned by deploy/ and
# applied by pyinfra on every push to main (deploy-pyinfra.yml).
#
# Only one thing remains here: confirm the SSM agent is running so the
# pyinfra deploy can reach a fresh host over SSH-through-SSM. AL2023 ships
# and enables the agent by default; this is a no-op safety net.

systemctl enable --now amazon-ssm-agent
