/**
 * The service account's two tokens, for stacks that were not given them.
 *
 * Production's API holds two tokens for the `bindersnap-service` account,
 * minted at deploy:
 *
 * - **The read token** — read scopes only. Every privileged read uses it:
 *   branch protection, teams, the approvals whitelist, avatars, the email
 *   lookup at sign-in. These run on nearly every request, so a leak or a bug
 *   in any of them can expose only what the token can read.
 * - **The admin token** — `write:admin` and nothing else. Only the four acts
 *   that need it: creating an account at signup, setting a new password,
 *   deleting an account, and revoking a session's token. Each is rare, and
 *   each has already checked the person's own password.
 *
 * The service account is a Gitea site admin, so a token's scopes are the only
 * thing standing between a read path and root-equivalent power. One token with
 * both was that power on every request.
 *
 * Dev and test stacks come up with only the admin's password, so outside
 * production, with admin credentials and no configured token, the API mints
 * each for itself at startup with the same scopes production's has. Until one
 * arrives — or if minting fails — the privileged calls keep using basic auth.
 * Basic auth was the only path once, and Gitea hashes the password on every
 * such request, which measured about three times the cost of a token call.
 */

import { config } from "./config";
import { logger } from "./logger";

export type ServiceTokenKind = "read" | "admin";

/**
 * Production's scopes — see `deploy/files/scripts/bootstrap-gitea-service-account.ts`,
 * which a test holds these to. The same, so a call that needs more than
 * production grants fails in dev too.
 */
export const SERVICE_TOKEN_SCOPES: Record<ServiceTokenKind, readonly string[]> =
  {
    // `read:admin` is the email search at sign-in (`/admin/emails/search`).
    read: [
      "read:admin",
      "read:issue",
      "read:organization",
      "read:repository",
      "read:user",
    ],
    admin: ["write:admin"],
  };

/** Named so a restart replaces each rather than leaving one more behind. */
export const DEV_SERVICE_TOKEN_NAMES: Record<ServiceTokenKind, string> = {
  read: "bindersnap-api-dev-service",
  admin: "bindersnap-api-dev-admin",
};

const minted: Record<ServiceTokenKind, string | null> = {
  read: null,
  admin: null,
};

/** The token this process minted for itself, once it has one. */
export function devServiceToken(
  kind: ServiceTokenKind = "read",
): string | null {
  return minted[kind];
}

/** The token privileged reads use: the configured one, else a minted one. */
export function serviceToken(): string | null {
  return config.giteaServiceToken || minted.read;
}

/**
 * The token admin acts use: the configured one, else a minted one.
 *
 * Failing both, the service token. Before the split, production had one
 * token holding `write:admin` and the reads together; a host whose deploy has
 * not minted the admin token yet still has that one token, and signup keeps
 * working on it until the next deploy splits it.
 */
export function adminToken(): string | null {
  return (
    config.giteaAdminToken || minted.admin || config.giteaServiceToken || null
  );
}

/** For tests. */
export function resetDevServiceToken(): void {
  minted.read = null;
  minted.admin = null;
}

function configured(kind: ServiceTokenKind): string {
  return kind === "read" ? config.giteaServiceToken : config.giteaAdminToken;
}

/** Mint whichever of the two tokens this stack was not given. */
export async function mintDevServiceTokens(
  options: { attempts?: number; delayMs?: number } = {},
): Promise<Record<ServiceTokenKind, string | null>> {
  const [read, admin] = await Promise.all([
    mintDevServiceToken("read", options),
    mintDevServiceToken("admin", options),
  ]);
  return { read, admin };
}

export async function mintDevServiceToken(
  kind: ServiceTokenKind,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  if (
    config.isProduction ||
    configured(kind) ||
    !config.giteaAdminUsername ||
    !config.giteaAdminPassword
  ) {
    return null;
  }

  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 2000;
  const name = DEV_SERVICE_TOKEN_NAMES[kind];
  const username = encodeURIComponent(config.giteaAdminUsername);
  const tokens = new URL(`/api/v1/users/${username}/tokens`, config.giteaUrl);
  const auth = `Basic ${Buffer.from(
    `${config.giteaAdminUsername}:${config.giteaAdminPassword}`,
  ).toString("base64")}`;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Gitea refuses a second token with the same name, and one from the last
      // run is unrecoverable anyway — its value was never stored.
      await fetch(new URL(`${tokens.pathname}/${name}`, tokens), {
        method: "DELETE",
        headers: { Authorization: auth },
      });

      const response = await fetch(tokens, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: SERVICE_TOKEN_SCOPES[kind] }),
      });
      if (response.ok) {
        const body = (await response.json()) as { sha1?: string };
        if (body.sha1) {
          minted[kind] = body.sha1;
          logger.info("Minted a dev service token", { kind, name });
          return body.sha1;
        }
      }
      logger.warn("Could not mint a dev service token yet", {
        kind,
        attempt,
        status: response.status,
      });
    } catch (err) {
      logger.warn("Could not mint a dev service token yet", {
        kind,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < attempts) await Bun.sleep(delayMs);
  }

  logger.warn("No dev service token; its calls stay on basic auth this run", {
    kind,
  });
  return null;
}
