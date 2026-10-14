/**
 * Claude Code PostToolUse hook for Edit and Write: formats the one file Claude
 * just changed, with the same ignore files `bun run format` uses, so a commit
 * never fails `bun run format:check` on Claude's own edits.
 *
 * Never blocks: a file Prettier cannot parse is left as it is.
 */

import { relative } from "node:path";

export const FORMATTED = /\.(js|ts|jsx|tsx|html|css|json|ya?ml|md)$/;

export function shouldFormat(filePath: string, projectDir: string): boolean {
  const path = relative(projectDir, filePath);
  return FORMATTED.test(path) && !path.startsWith("..");
}

if (import.meta.main) {
  const input = (await Bun.stdin.json()) as {
    tool_input?: { file_path?: string };
  };
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const filePath = input.tool_input?.file_path;
  if (filePath && shouldFormat(filePath, projectDir)) {
    Bun.spawnSync(
      [
        "bunx",
        "prettier",
        "--write",
        "--log-level=silent",
        "--ignore-path",
        ".gitignore",
        "--ignore-path",
        ".prettierignore",
        filePath,
      ],
      { cwd: projectDir, stdout: "ignore", stderr: "ignore" },
    );
  }
}
