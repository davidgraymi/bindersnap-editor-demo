/**
 * A service token for stacks that were not given one.
 *
 * Production's API reads Gitea's privileged answers (branch protection, team
 * membership, the approvals whitelist) with a service token minted at deploy.
 * Dev and test stacks come up with only the admin's password, so those reads
 * fell back to HTTP basic auth — and Gitea hashes the password on every basic
 * auth request, which measured about three times the cost of a token call.
 * Dev is where the request gate was tuned and where "the app is slow" gets
 * noticed, so it was being measured against a cost production never pays.
 *
 * So outside production, with admin credentials and no service token, the API
 * mints one for itself at startup with the same scopes production's has. Until
 * it arrives — or if minting fails — the privileged clients keep using basic
 * auth, exactly as before.
 */

import { config } from "./config";
import { logger } from "./logger";

/** Named so a restart replaces it rather than leaving one more behind. */
export const DEV_SERVICE_TOKEN_NAME = "bindersnap-api-dev-service";

/**
 * The scopes production's service token is minted with — see
 * `deploy/files/scripts/bootstrap-gitea-service-account.ts`. The same, so a
 * privileged read that needs more than production grants fails in dev too.
 */
export const DEV_SERVICE_TOKEN_SCOPES = [
  "write:admin",
  "read:issue",
  "read:organization",
  "read:repository",
  "read:user",
];

let minted: string | null = null;

/** The token this process minted for itself, once it has one. */
export function devServiceToken(): string | null {
  return minted;
}

/** The token privileged reads should use: the configured one, else a minted one. */
export function serviceToken(): string | null {
  return config.giteaServiceToken || minted;
}

/** For tests. */
export function resetDevServiceToken(): void {
  minted = null;
}

export async function mintDevServiceToken(
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  if (
    config.isProduction ||
    config.giteaServiceToken ||
    !config.giteaAdminUsername ||
    !config.giteaAdminPassword
  ) {
    return null;
  }

  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 2000;
  const username = encodeURIComponent(config.giteaAdminUsername);
  const tokens = new URL(`/api/v1/users/${username}/tokens`, config.giteaUrl);
  const auth = `Basic ${Buffer.from(
    `${config.giteaAdminUsername}:${config.giteaAdminPassword}`,
  ).toString("base64")}`;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Gitea refuses a second token with the same name, and one from the last
      // run is unrecoverable anyway — its value was never stored.
      await fetch(
        new URL(`${tokens.pathname}/${DEV_SERVICE_TOKEN_NAME}`, tokens),
        {
          method: "DELETE",
          headers: { Authorization: auth },
        },
      );

      const response = await fetch(tokens, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: DEV_SERVICE_TOKEN_NAME,
          scopes: DEV_SERVICE_TOKEN_SCOPES,
        }),
      });
      if (response.ok) {
        const body = (await response.json()) as { sha1?: string };
        if (body.sha1) {
          minted = body.sha1;
          logger.info("Minted a dev service token; privileged reads use it", {
            name: DEV_SERVICE_TOKEN_NAME,
          });
          return minted;
        }
      }
      logger.warn("Could not mint a dev service token yet", {
        attempt,
        status: response.status,
      });
    } catch (err) {
      logger.warn("Could not mint a dev service token yet", {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < attempts) await Bun.sleep(delayMs);
  }

  logger.warn(
    "No dev service token; privileged reads stay on basic auth for this run",
  );
  return null;
}
