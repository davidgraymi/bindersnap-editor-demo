/**
 * Claude Code SessionStart and SessionEnd hook: installs dependencies when a
 * session opens, and tears this worktree's stack down when it closes, so a
 * remote-control session in a throwaway worktree stops leaving five containers
 * and a claimed port block behind.
 *
 * Teardown runs `bun run down`, never `docker compose` directly: the raw
 * command resolves the shared default project name and would take down the
 * developer's own stack (AGENTS.md, "The stack, if you are an agent in a
 * worktree", rule 1). For the same reason it runs only in a linked worktree —
 * in the main checkout the stack belongs to the developer, not to a session.
 *
 * Never blocks: a failed install or teardown is reported on stderr and the
 * session carries on. SessionEnd does not fire when a session is killed rather
 * than closed, so `bun run stack prune` is still the backstop for stacks whose
 * worktree is already gone.
 */

export function shouldInstall(source?: string): boolean {
  // `clear` and `compact` reuse a session whose dependencies are already there.
  return source === undefined || source === "startup" || source === "resume";
}

export function shouldTeardown(reason?: string): boolean {
  // `/clear` ends the session object, but the developer is still working in it
  // and still wants their stack up.
  return reason !== "clear";
}

export function isLinkedWorktree(gitDir: string): boolean {
  return gitDir.includes("/worktrees/");
}

function capture(args: string[], cwd: string): string {
  return Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "ignore" })
    .stdout.toString()
    .trim();
}

function report(args: string[], cwd: string): void {
  const { exitCode } = Bun.spawnSync(args, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (exitCode !== 0) {
    console.error(`[session-stack] ${args.join(" ")} exited ${exitCode}`);
  }
}

if (import.meta.main) {
  const input = (await Bun.stdin.json()) as {
    hook_event_name?: string;
    source?: string;
    reason?: string;
  };
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  if (input.hook_event_name === "SessionEnd") {
    const gitDir = capture(
      ["git", "rev-parse", "--absolute-git-dir"],
      projectDir,
    );
    if (shouldTeardown(input.reason) && isLinkedWorktree(gitDir)) {
      report(["bun", "run", "down"], projectDir);
    }
  } else if (shouldInstall(input.source)) {
    report(["bun", "install"], projectDir);
  }
}
