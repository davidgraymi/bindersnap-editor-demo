"""Unit tests for the pure `.env.prod` render logic (epic #302, phase #304).

Run standalone: `python3 deploy/env_render_test.py` (exit 0 == pass). The bun
suite drives this via `scripts/deploy-pyinfra.test.ts` so it runs inside
`bun run test:ops` with no extra Python toolchain.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from env_render import BOOTSTRAP_TOKEN_PLACEHOLDER, build_env_content

PATH = "/bindersnap/prod"


def _param(name, value):
    return {"Name": f"{PATH}/{name}", "Value": value}


def test_sorts_and_upper_snakes_leaf_names():
    content = build_env_content(
        [
            _param("api-tag", "v1"),
            _param("gitea_admin_user", "admin"),
        ],
        PATH,
    )
    # Sorted by SSM name (api-tag < gitea_admin_user), dashes -> underscores, upper.
    assert content == "API_TAG=v1\nGITEA_ADMIN_USER=admin\n", repr(content)


def test_drops_admin_creds_once_token_is_real():
    content = build_env_content(
        [
            _param("gitea_admin_user", "admin"),
            _param("gitea_admin_pass", "s3cret"),
            _param("gitea_service_token", "real-token-abc"),
            _param("api-tag", "v1"),
        ],
        PATH,
    )
    lines = content.splitlines()
    assert "GITEA_ADMIN_USER=admin" not in lines, content
    assert "GITEA_ADMIN_PASS=s3cret" not in lines, content
    assert "GITEA_SERVICE_TOKEN=real-token-abc" in lines, content
    assert "API_TAG=v1" in lines, content


def test_keeps_admin_creds_while_token_is_placeholder():
    content = build_env_content(
        [
            _param("gitea_admin_user", "admin"),
            _param("gitea_admin_pass", "s3cret"),
            _param("gitea_service_token", BOOTSTRAP_TOKEN_PLACEHOLDER),
        ],
        PATH,
    )
    lines = content.splitlines()
    # Bootstrap needs the admin creds to mint the real token on first run.
    assert "GITEA_ADMIN_USER=admin" in lines, content
    assert "GITEA_ADMIN_PASS=s3cret" in lines, content


def test_rejects_newline_values():
    try:
        build_env_content([_param("some_key", "line1\nline2")], PATH)
    except SystemExit as exc:
        assert "newline" in str(exc), exc
    else:
        raise AssertionError("expected SystemExit for a value containing a newline")


def test_rejects_empty_parameter_set():
    try:
        build_env_content([], PATH)
    except SystemExit as exc:
        assert "No SSM parameters" in str(exc), exc
    else:
        raise AssertionError("expected SystemExit when no parameters are found")


def test_trailing_slash_in_path_is_tolerated():
    # deploy.py passes SSM_PARAMETER_PATH which may or may not carry a slash.
    content = build_env_content([_param("api-tag", "v1")], PATH + "/")
    assert content == "API_TAG=v1\n", repr(content)


def test_ignores_params_outside_the_prefix():
    content = build_env_content(
        [
            _param("api-tag", "v1"),
            {"Name": "/other/tree/secret", "Value": "nope"},
        ],
        PATH,
    )
    assert content == "API_TAG=v1\n", repr(content)


def test_values_with_special_chars_pass_through_verbatim():
    # Docker env files take the value literally; slashes/=/spaces must survive.
    content = build_env_content(
        [_param("db_url", "postgres://u:p@h:5432/db?x=1")], PATH
    )
    assert content == "DB_URL=postgres://u:p@h:5432/db?x=1\n", repr(content)


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
    print(f"ok - {len(tests)} env_render tests passed")


if __name__ == "__main__":
    main()
