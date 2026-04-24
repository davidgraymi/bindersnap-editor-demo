const REQUIRED_GITEA_TOKEN_SCOPES = [
  "write:user",
  "write:repository",
  "write:issue",
] as const;

export function resolveGiteaTokenScopes(scopesRaw?: string): string[] {
  const configuredScopes = (scopesRaw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");

  return Array.from(
    new Set<string>([...configuredScopes, ...REQUIRED_GITEA_TOKEN_SCOPES]),
  );
}
