import { config } from "./config";
import { serviceToken } from "./dev-service-token";
import {
  createGiteaBasicAuthClient,
  createGiteaClient,
  type GiteaClient,
} from "./gitea-client/client";

/**
 * A client that can read what the caller is not allowed to, or null.
 *
 * The service token is the real answer. Dev and test stacks come up without
 * one, so they fall back to the admin credentials the BFF already holds — the
 * same fallback `buildGiteaPrivilegedHeaders` makes for the raw-fetch calls,
 * kept in one shape so the two cannot drift apart.
 */
export function createPrivilegedGiteaClient(): GiteaClient | null {
  // The configured token, or — outside production — the one this process
  // minted for itself at startup. See `dev-service-token.ts`.
  const token = serviceToken();
  if (token) {
    return createGiteaClient(config.giteaUrl, token);
  }

  if (
    !config.isProduction &&
    config.giteaAdminUsername &&
    config.giteaAdminPassword
  ) {
    return createGiteaBasicAuthClient(
      config.giteaUrl,
      config.giteaAdminUsername,
      config.giteaAdminPassword,
    );
  }

  return null;
}
