/**
 * Development server — serves both SPAs and auto-discovers the OAuth client ID.
 */

import { serve } from "bun";
import index from "./apps/landing/index.html";
import appIndex from "./apps/app/index.html";

const configuredPort = Number.parseInt(
  process.env.PORT ?? process.env.APP_PORT ?? "5173",
  10,
);
const appPort =
  Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5173;

// Auto-discover the OAuth client ID from Gitea when not already set.
// In Docker, the seed container creates the OAuth app before the app starts,
// and admin credentials are available in the container environment.
if (!process.env.BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID) {
  const giteaUrl =
    process.env.GITEA_INTERNAL_URL ??
    process.env.BUN_PUBLIC_GITEA_URL ??
    "http://localhost:3000";
  const adminUser = process.env.GITEA_ADMIN_USER;
  const adminPass = process.env.GITEA_ADMIN_PASS;

  if (adminUser && adminPass) {
    try {
      const res = await fetch(
        `${giteaUrl}/api/v1/user/applications/oauth2`,
        {
          headers: {
            Authorization: `Basic ${btoa(`${adminUser}:${adminPass}`)}`,
            Accept: "application/json",
          },
        },
      );
      if (res.ok) {
        const apps = (await res.json()) as Array<{
          name?: string;
          client_id?: string;
        }>;
        const found = apps.find((a) => a.name === "bindersnap-dev");
        if (found?.client_id) {
          process.env.BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID = found.client_id;
          console.log(
            `Auto-discovered OAuth client ID: ${found.client_id}`,
          );
        }
      }
    } catch {
      // Gitea not reachable — user must set the env var manually.
    }
  }
}

const server = serve({
  port: appPort,
  routes: {
    "/app": appIndex,
    "/app/*": appIndex,
    "/auth/callback": appIndex,
    "/login": appIndex,
    "/login/*": appIndex,

    // Both apps are always reachable at their explicit prefix.
    "/landing": index,
    "/landing/*": index,

    // Wildcard: serve whichever app is the current dev target.
    "/*": process.env.APP_TARGET === "landing" ? index : appIndex,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at http://localhost:${appPort}/`);
