/**
 * Signed in to the API as one person, from a script rather than a browser.
 *
 * The generated client (`packages/api-client`) is the browser's: it sends
 * `credentials: "include"` and lets the browser hold the cookie and the
 * origin. A script has neither, so a session carries both and hands them to
 * every call as `options`:
 *
 *     const alice = await signIn("alice", "dev");
 *     await createOrganization({ name: "Riverside Health" }, alice.options);
 *
 * Same client, same request shapes, same server code as the app — which is
 * the whole reason the seed talks to the API instead of to Gitea.
 */

import { authLogin, authLogout } from "../packages/api-client/auth/auth";

export const API_BASE_URL =
  process.env.BUN_PUBLIC_API_BASE_URL ??
  `http://localhost:${process.env.API_PROXY_PORT ?? "8788"}`;

export const APP_ORIGIN =
  process.env.BINDERSNAP_APP_ORIGIN ??
  `http://localhost:${process.env.APP_PORT ?? "5173"}`;

// The generated client reads its base URL from here on every request.
process.env.BUN_PUBLIC_API_BASE_URL = API_BASE_URL;

export interface BffSession {
  username: string;
  /** The `bindersnap_session` cookie's value. */
  cookie: string;
  /** Pass as the generated client's last argument. */
  options: RequestInit;
}

function sessionOptions(cookie: string): RequestInit {
  return {
    headers: {
      Cookie: `bindersnap_session=${cookie}`,
      // Every mutation passes the API's state-changing origin check, which a
      // browser satisfies without trying and a script has to say out loud.
      Origin: APP_ORIGIN,
    },
  };
}

export async function signIn(
  username: string,
  password: string,
): Promise<BffSession> {
  const response = await authLogin(
    { username, password },
    { headers: { Origin: APP_ORIGIN } },
  );
  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  if (!match?.[1]) {
    throw new Error(`Signing in as ${username} returned no session cookie.`);
  }
  return { username, cookie: match[1], options: sessionOptions(match[1]) };
}

/**
 * Every session ends signed out, so a seed that runs on every test suite does
 * not leave a Gitea token behind per person per run.
 */
export async function signOut(session: BffSession): Promise<void> {
  await authLogout(session.options).catch(() => undefined);
}

/**
 * Signed in once per person, on first use.
 *
 * Several binders are seeded at once and most of their acts are somebody
 * else's, so the same person is wanted by many hands at the same moment —
 * one sign-in, shared as the promise.
 */
export class Sessions {
  readonly #password: string;
  readonly #sessions = new Map<string, Promise<BffSession>>();

  constructor(password: string) {
    this.#password = password;
  }

  as(username: string): Promise<BffSession> {
    let session = this.#sessions.get(username);
    if (!session) {
      session = signIn(username, this.#password);
      this.#sessions.set(username, session);
    }
    return session;
  }

  async options(username: string): Promise<RequestInit> {
    return (await this.as(username)).options;
  }

  async closeAll(): Promise<void> {
    const sessions = await Promise.allSettled(this.#sessions.values());
    await Promise.all(
      sessions.map((result) =>
        result.status === "fulfilled" ? signOut(result.value) : undefined,
      ),
    );
    this.#sessions.clear();
  }
}
