import { describe, expect, test } from "bun:test";

import { shouldFormat } from "./format-edited";
import { refusalFor } from "./guard-bash";

describe("guard-bash", () => {
  test.each([
    "docker compose down",
    "docker compose -f docker-compose.yml up -d",
    "docker --context default compose ps",
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
