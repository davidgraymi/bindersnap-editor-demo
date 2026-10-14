/**
 * Claude Code PreToolUse hook for Bash: refuses the commands AGENTS.md forbids.
 *
 * A raw `docker compose` from a worktree acts on the shared default project, so
 * it can tear down another session's stack, or the developer's own. A force
 * push to `main` or a `development/*` branch rewrites history other stacks are
 * built on. Exit code 2 blocks the call and hands the reason back to Claude.
 */

export interface Refusal {
  reason: string;
}

const PROTECTED_BRANCH = /(^|[\s:/])(main|development\/[\w.\/-]+)(\s|$)/;

/**
 * The command with heredoc bodies and quoted strings blanked out, so text that
 * only mentions `docker compose` (a PR body, a grep pattern, a commit message)
 * is not mistaken for running it.
 */
export function withoutQuotedText(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g, "")
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Whether the tokens run `docker compose`, allowing global flags in between
 * (`docker --context default compose`). A token scan rather than a regex, so
 * the time it takes grows with the command, never faster.
 */
export function runsDockerCompose(tokens: string[]): boolean {
  const start = tokens[0] === "sudo" ? 1 : 0;
  if (tokens[start] === "docker-compose") return true;
  if (tokens[start] !== "docker") return false;

  let previousWasBareFlag = false;
  for (const token of tokens.slice(start + 1)) {
    if (token === "compose") return true;
    if (token.startsWith("-")) {
      previousWasBareFlag = !token.includes("=");
    } else if (previousWasBareFlag) {
      previousWasBareFlag = false; // that flag's value
    } else {
      return false; // another subcommand: `docker ps`, `docker logs`
    }
  }
  return false;
}

export function refusalFor(command: string): Refusal | null {
  for (const part of withoutQuotedText(command).split(/&&|\|\||;|\n/)) {
    const words = part.trim();

    if (runsDockerCompose(words.split(/\s+/))) {
      return {
        reason:
          "Never run docker compose directly: it acts on the shared default " +
          "stack. Use `bun run up`, `bun run down`, `bun run stack status` or " +
          "`bun run stack logs [service]` from this worktree.",
      };
    }

    if (
      /^git\s+push\b/.test(words) &&
      /\s(--force|-f|--force-with-lease)(=\S+)?(\s|$)/.test(words) &&
      PROTECTED_BRANCH.test(words.replace(/^git\s+push\b/, ""))
    ) {
      return {
        reason:
          "Never force-push main or a development/* branch: stacked PRs are " +
          "based on them. Force-push only your own feature branch.",
      };
    }
  }
  return null;
}

if (import.meta.main) {
  const input = (await Bun.stdin.json()) as {
    tool_input?: { command?: string };
  };
  const refusal = refusalFor(input.tool_input?.command ?? "");
  if (refusal) {
    console.error(refusal.reason);
    process.exit(2);
  }
}
