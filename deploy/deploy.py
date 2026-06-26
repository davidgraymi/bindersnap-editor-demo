"""Bindersnap production deployment (epic #302).

Phase 1 (#303): connectivity check only — proves pyinfra can reach the host
through the SSM tunnel. The real host configuration (Docker, EBS mount, config
upload, secret refresh, compose up) lands in Phase 2 (#304).
"""

from pyinfra.operations import server

server.shell(
    name="Connectivity check",
    commands=[
        "whoami",
        "hostname",
        "uname -a",
    ],
)
