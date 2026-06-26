"""pyinfra inventory for the Bindersnap production host (epic #302).

Connection model: SSH tunnelled over AWS SSM, so the host needs no inbound
port 22 and we keep no long-lived SSH keys.

  1. ``deploy/bin/ssm-connect.sh`` resolves the running instance by tag,
     generates an ephemeral keypair, and pushes the public half to the host
     via EC2 Instance Connect (valid ~60s).
  2. It writes a throwaway SSH config whose ``ProxyCommand`` tunnels the
     transport through ``aws ssm start-session`` (the AWS-StartSSHSession
     document), then exports the variables this file reads and invokes pyinfra.
  3. pyinfra parses that config and opens the proxied connection lazily,
     authenticating with the ephemeral key.

Run deploys through the wrapper rather than invoking pyinfra directly, or
export ``BINDERSNAP_INSTANCE_ID``, ``BINDERSNAP_SSH_KEY`` and
``BINDERSNAP_SSH_CONFIG`` yourself first.
"""

import os

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
SSH_USER = os.environ.get("BINDERSNAP_SSH_USER", "ec2-user")

_instance_id = os.environ.get("BINDERSNAP_INSTANCE_ID")
_ssh_key = os.environ.get("BINDERSNAP_SSH_KEY")
_ssh_config = os.environ.get("BINDERSNAP_SSH_CONFIG")

if not _instance_id or not _ssh_key or not _ssh_config:
    raise RuntimeError(
        "BINDERSNAP_INSTANCE_ID, BINDERSNAP_SSH_KEY and BINDERSNAP_SSH_CONFIG "
        "must be set before running pyinfra. Use deploy/bin/ssm-connect.sh, "
        "which resolves the instance, pushes an ephemeral key and writes the "
        "SSM-tunnel SSH config, then invokes pyinfra for you."
    )

# The ProxyCommand that tunnels SSH over SSM lives in the generated config
# file; pyinfra parses it and builds the proxy lazily at connect time.
host_data = {
    "ssh_user": SSH_USER,
    "ssh_key": _ssh_key,
    "ssh_config_file": _ssh_config,
    # The instance is rebuilt from an AMI, so its host key is not stable;
    # accept-new avoids an interactive prompt on first contact.
    "ssh_strict_host_key_checking": "accept-new",
}

hosts = [(_instance_id, host_data)]
