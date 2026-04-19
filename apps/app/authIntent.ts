export function resolveSignupPrefill(search: string): { email: string } {
  const params = new URLSearchParams(search);
  return {
    email: (params.get("email") ?? "").trim(),
  };
}
