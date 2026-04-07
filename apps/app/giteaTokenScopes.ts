const REQUIRED_GITEA_TOKEN_SCOPES = [
  "write:user",
  "write:repository",
  "write:issue",
] as const;

export function resolveGiteaTokenScopes(scopesRaw?: string): string[] {
  const configuredScopes = (scopesRaw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  const mergedScopes = new Set<string>([
    ...configuredScopes,
    ...REQUIRED_GITEA_TOKEN_SCOPES,
  ]);

  return Array.from(mergedScopes);
}
