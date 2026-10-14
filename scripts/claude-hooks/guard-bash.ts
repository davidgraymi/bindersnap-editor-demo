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

export function refusalFor(command: string): Refusal | null {
  for (const part of withoutQuotedText(command).split(/&&|\|\||;|\n/)) {
    const words = part.trim();

    if (
      /^(sudo\s+)?docker(\s+--?[\w-]+(=\S+|\s+[^-\s]\S*)?)*\s+compose\b/.test(
        words,
      ) ||
      /^(sudo\s+)?docker-compose\b/.test(words)
    ) {
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
