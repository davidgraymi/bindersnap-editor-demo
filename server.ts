import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { file, serve } from "bun";
import appIndex from "./apps/app/index.html";
import { HELP_GUIDES } from "./apps/app/helpGuides";
import { helpContentType, helpFiles } from "./apps/help/renderHelp";
import { readLegalDocuments } from "./apps/legal/legalDocuments";
import { legalFiles } from "./apps/legal/renderLegal";
import { publicSiteFiles } from "./apps/site/publicSite";
import { siteContentType } from "./apps/site/renderSite";
import { SITE_COLLECTIONS } from "./apps/site/siteContent";

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

/** The legal pages, the same way: read on each request so an edit shows. */
function serveLegal(req: Request): Response {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  const body = legalFiles(readLegalDocuments()).get(path);
  return body === undefined
    ? new Response("No such page.", { status: 404 })
    : new Response(body, {
        headers: { "Content-Type": helpContentType(path) },
      });
}

/**
 * The public site — pricing, templates and the other marketing pages, the
 * sitemap, robots.txt and the llms files — read on each request, so an edit to
 * a page in `apps/site/content` shows on reload. Anything it does not have
 * is not the site's.
 */
async function serveSite(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  const body = publicSiteFiles().get(path);
  return body === undefined
    ? new Response("No such page.", { status: 404 })
    : new Response(body, {
        headers: { "Content-Type": siteContentType(path) },
      });
}

/**
 * Every address the public site has now, and every collection's prefix so a
 * page added while the server runs is served too.
 */
const siteRoutes = Object.fromEntries([
  ...[...publicSiteFiles().keys()].map((path) => [path, serveSite] as const),
  ...SITE_COLLECTIONS.filter((collection) => collection.prefix).map(
    (collection) => [`/${collection.prefix}/*`, serveSite] as const,
  ),
]);

/**
 * The icons, the link-preview image and the fonts, at the site root where the
 * build copies them for GitHub Pages: `/favicon.ico`, `/fonts/fonts.css` and
 * the rest.
 */
const PUBLIC_DIR = join(import.meta.dir, "apps/app/public");
const publicFiles = Object.fromEntries(
  readdirSync(PUBLIC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [`/${relative(PUBLIC_DIR, path)}`, () => new Response(file(path))];
    }),
);

const configuredPort = Number.parseInt(
  process.env.PORT ?? process.env.APP_PORT ?? "5173",
  10,
);
const appPort =
  Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5173;

const server = serve({
  port: appPort,
  routes: {
    ...publicFiles,
    ...siteRoutes,
    "/help": serveHelp,
    "/help/*": serveHelp,
    "/legal": serveLegal,
    "/legal/*": serveLegal,
    "/": appIndex,
    "/docs/*": appIndex,
    "/auth/callback": appIndex,
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
