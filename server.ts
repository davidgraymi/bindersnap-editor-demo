import { serve } from "bun";
import appIndex from "./apps/app/index.html";
import { HELP_GUIDES } from "./apps/app/helpGuides";
import { helpContentType, helpFiles } from "./apps/help/renderHelp";

/**
 * Help is plain pages, not the app: the same files `scripts/build-help.ts`
 * writes into `dist/help` for GitHub Pages, rendered on each request here so an
 * edit to a guide shows on reload.
 */
function serveHelp(req: Request): Response {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  const body = helpFiles(HELP_GUIDES).get(path);
  return body === undefined
    ? new Response("No such guide.", { status: 404 })
    : new Response(body, {
        headers: { "Content-Type": helpContentType(path) },
      });
}

const configuredPort = Number.parseInt(
  process.env.PORT ?? process.env.APP_PORT ?? "5173",
  10,
);
const appPort =
  Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5173;

const server = serve({
  port: appPort,
  routes: {
    "/help": serveHelp,
    "/help/*": serveHelp,
    "/llms.txt": serveHelp,
    "/": appIndex,
    "/docs/*": appIndex,
    "/auth/callback": appIndex,
    "/login": appIndex,
    "/login/*": appIndex,
    "/*": appIndex,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 App server running at http://localhost:${appPort}/`);
