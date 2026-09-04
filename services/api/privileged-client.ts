import { config } from "./config";
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
  if (config.giteaServiceToken) {
    return createGiteaClient(config.giteaUrl, config.giteaServiceToken);
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
