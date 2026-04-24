// Bun's bundler (`bun build --env='BUN_PUBLIC_*'`) replaces
// process.env.BUN_PUBLIC_API_BASE_URL with a literal string at compile time.
// - GitHub Pages build: BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com
// - Local dev stack:    BUN_PUBLIC_API_BASE_URL=http://localhost:8787
export const apiBaseUrl = (process.env.BUN_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
