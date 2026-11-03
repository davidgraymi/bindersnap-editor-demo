import { describe, expect, test } from "bun:test";

import { shouldFormat } from "./format-edited";
import { refusalFor } from "./guard-bash";
import {
  isLinkedWorktree,
  shouldInstall,
  shouldTeardown,
} from "./session-stack";

describe("guard-bash", () => {
  test.each([
    "docker compose down",
    "docker compose -f docker-compose.yml up -d",
    "docker --context default compose ps",
    "docker --debug compose ps",
    "docker --log-level=debug compose up",
    "docker-compose up",
    "cd infra && docker compose logs api",
    "sudo docker compose restart",
    "cat <<EOF > notes.txt\nhello\nEOF\ndocker compose down",
    'echo "done" && docker compose ps',
    "git push --force origin main",
    "git push -f origin development/binders-gitea-28",
    "git push --force-with-lease origin HEAD:main",
  ])("refuses %s", (command) => {
    expect(refusalFor(command)).not.toBeNull();
  });

  test.each([
    "bun run up",
    "bun run stack logs api",
    "docker ps",
    "docker logs bindersnap-api-1",
    "git push -u origin chore/claude-settings",
    "git push --force-with-lease origin feat/maintenance-banner",
    "git push origin main",
    "grep -n 'docker compose' AGENTS.md",
    'git commit -m "fix: never cd x && docker compose down"',
    "gh pr create --body-file - <<'EOF'\nNever `cd x && docker compose down`\ndocker compose up\nEOF",
  ])("allows %s", (command) => {
    expect(refusalFor(command)).toBeNull();
  });

  test("a long run of flags is checked in linear time", () => {
    const started = performance.now();
    expect(refusalFor(`docker -${" -- -".repeat(20_000)}`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("format-edited", () => {
  test("formats source files inside the project", () => {
    expect(shouldFormat("/repo/apps/app/main.tsx", "/repo")).toBe(true);
    expect(shouldFormat("/repo/AGENTS.md", "/repo")).toBe(true);
  });

  test("leaves other files alone", () => {
    expect(shouldFormat("/repo/deploy/deploy.py", "/repo")).toBe(false);
    expect(shouldFormat("/elsewhere/notes.md", "/repo")).toBe(false);
  });
});

describe("session-stack", () => {
  test.each(["startup", "resume", undefined])("installs on %s", (source) => {
    expect(shouldInstall(source)).toBe(true);
  });

  test.each(["clear", "compact"])("does not install on %s", (source) => {
    expect(shouldInstall(source)).toBe(false);
  });

  test.each(["logout", "prompt_input_exit", "other", undefined])(
    "tears down on %s",
    (reason) => {
      expect(shouldTeardown(reason)).toBe(true);
    },
  );

  test("leaves the stack up on /clear", () => {
    // The session object ends but the developer is still working in it.
    expect(shouldTeardown("clear")).toBe(false);
  });

  test("only tears down inside a linked worktree", () => {
    expect(
      isLinkedWorktree("/repo/.git/worktrees/bridge-cse_01WmYDxJ64NEu9MW8B8ox"),
    ).toBe(true);
    expect(isLinkedWorktree("/repo/.git")).toBe(false);
    expect(isLinkedWorktree("")).toBe(false);
  });
});
