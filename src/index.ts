import { serve } from "bun";
import index from "./index.html";
import appIndex from "./app/index.html";

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function isAutoLoginEnabled(): boolean {
  const explicitValue = process.env.BINDERSNAP_DEV_AUTO_LOGIN;
  if (explicitValue !== undefined) {
    return parseBoolean(explicitValue);
  }

  return process.env.NODE_ENV !== "production";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const devAutoLoginEnabled = isAutoLoginEnabled();
const giteaInternalUrl =
  process.env.GITEA_INTERNAL_URL ??
  process.env.VITE_GITEA_URL ??
  process.env.BUN_PUBLIC_GITEA_URL ??
  "http://localhost:3000";
const giteaAdminUser = process.env.GITEA_ADMIN_USER ?? "";
const giteaAdminPass = process.env.GITEA_ADMIN_PASS ?? "";
const configuredPort = Number.parseInt(process.env.PORT ?? process.env.APP_PORT ?? "5173", 10);
const appPort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5173;

const server = serve({
  port: appPort,
  routes: {
    "/api/dev/gitea-token": {
      async POST() {
        if (!devAutoLoginEnabled) {
          return new Response("Not Found", { status: 404 });
        }

        if (!giteaAdminUser || !giteaAdminPass) {
          return jsonResponse(500, {
            error: "Missing GITEA_ADMIN_USER/GITEA_ADMIN_PASS for dev auto-login.",
          });
        }

        const tokenName = `bindersnap-ui-${Date.now()}`;
        const auth = Buffer.from(`${giteaAdminUser}:${giteaAdminPass}`).toString("base64");

        let response: Response;
        try {
          response = await fetch(
            new URL(`/api/v1/users/${encodeURIComponent(giteaAdminUser)}/tokens`, giteaInternalUrl),
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                name: tokenName,
                scopes: ["all"],
              }),
            },
          );
        } catch {
          return jsonResponse(502, {
            error: "Unable to reach Gitea while creating a dev token.",
          });
        }

        if (!response.ok) {
          return jsonResponse(502, {
            error: `Gitea token creation failed with status ${response.status}.`,
          });
        }

        const payload = (await response.json()) as { sha1?: unknown };
        if (typeof payload.sha1 !== "string" || payload.sha1.trim() === "") {
          return jsonResponse(502, {
            error: "Gitea returned no token value.",
          });
        }

        return jsonResponse(200, { token: payload.sha1 });
      },
    },

    "/app": appIndex,
    "/app/*": appIndex,
    "/auth/callback": appIndex,
    "/login": appIndex,

    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async (req) => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at http://localhost:${appPort}/`);
