/**
 * Where to go after signing in or signing up, when somebody arrived from a
 * link that needs an account — an invitation. Kept for this tab only, and
 * only ever an address inside the app.
 */
const KEY = "bindersnap.returnTo";

export function rememberReturnTo(path: string): void {
  if (!path.startsWith("/-/")) return;
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // Private mode: they land at home and can open the link again.
  }
}

/** The remembered address, once: reading it forgets it. */
export function takeReturnTo(): string | null {
  try {
    const path = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return path && path.startsWith("/-/") ? path : null;
  } catch {
    return null;
  }
}

/**
 * The invitation a signup is coming from, without forgetting where to return.
 * Sent with the signup: an invitation to the same address already proves it,
 * so no confirmation email is needed.
 */
export function pendingInvitationToken(): string | null {
  try {
    const path = window.sessionStorage.getItem(KEY) ?? "";
    const match = path.match(/^\/-\/invitations\/([A-Za-z0-9_-]+)(?:[?#]|$)/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}
