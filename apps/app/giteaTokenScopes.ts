const REQUIRED_GITEA_TOKEN_SCOPES = [
  "write:user",
  "write:repository",
  "write:issue",
  // Organizations own every workspace (ADR 0004), so reading one is table
  // stakes and creating one at signup is a write.
  "write:organization",
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
