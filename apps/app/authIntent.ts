type AuthMode = "signin" | "signup";

export function resolveAuthIntent(search: string): {
  mode: AuthMode;
  email: string;
} {
  const params = new URLSearchParams(search);
  return {
    mode: params.get("mode") === "signup" ? "signup" : "signin",
    email: (params.get("email") ?? "").trim(),
  };
}
