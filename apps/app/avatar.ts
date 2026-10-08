/**
 * Where a person's face comes from: the pattern the API draws for a login.
 *
 * Drawn by us, not fetched from Gravatar, so nobody outside Bindersnap learns
 * who is looking at whom. Asked at twice the drawn size, for screens that draw
 * two pixels for every one.
 */
const API_BASE_URL = (process.env.BUN_PUBLIC_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);

export function avatarUrl(login: string, drawnSize: number): string {
  return `${API_BASE_URL}/api/app/avatars/${encodeURIComponent(login)}?s=${drawnSize * 2}`;
}
