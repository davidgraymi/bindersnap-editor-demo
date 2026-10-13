import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { file, serve } from "bun";
import appIndex from "./apps/app/index.html";
import landingIndex from "./apps/site/index.html";
import { HELP_GUIDES } from "./apps/app/helpGuides";
import { appUrl } from "./apps/site/appLink";
import { helpContentType, helpFiles } from "./apps/help/renderHelp";
import { readLegalDocuments } from "./apps/legal/legalDocuments";
import { legalFiles } from "./apps/legal/renderLegal";
import { publicSiteBinaryFiles, publicSiteFiles } from "./apps/site/publicSite";
import { siteContentType } from "./apps/site/renderSite";
import { SITE_COLLECTIONS } from "./apps/site/siteContent";

/**
 * Help is plain pages, not the app: the same files `scripts/build-help.ts`
 * writes into `dist/help` for the static host, rendered on each request here so an
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
  if (path.endsWith(".docx")) {
    const bytes = (await publicSiteBinaryFiles()).get(path);
    return bytes === undefined
      ? new Response("No such page.", { status: 404 })
      : new Response(Buffer.from(bytes), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
        });
  }
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
 * The icons, the link-preview image and the fonts, at the root where the build
 * copies them for each static host: `/favicon.ico`, `/fonts/fonts.css` and
 * the rest.
 */
function publicFilesIn(dir: string): Record<string, () => Response> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [`/${relative(dir, path)}`, () => new Response(file(path))];
      }),
  );
}
const publicFiles = publicFilesIn(join(import.meta.dir, "apps/app/public"));

/**
 * What the site's Worker does with an address it has no file for: `/-/` goes
 * to the app with a 301 (`apps/site/public/_redirects`), and anything else
 * gets the 404 page, which forwards an organization's address to the app.
 */
function siteNotFound(req: Request): Response {
  const { pathname, search } = new URL(req.url);
  if (pathname.startsWith("/-/") || pathname.startsWith("/auth/")) {
    return Response.redirect(appUrl(`${pathname}${search}`), 301);
  }
  return new Response(publicSiteFiles().get("/404"), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function port(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const appPort = port(process.env.PORT ?? process.env.APP_PORT, 5173);
const sitePort = port(process.env.SITE_PORT, 5174);

const development = process.env.NODE_ENV !== "production" && {
  // Enable browser hot reloading in development
  hmr: true,

  // Echo console logs from the browser to the server
  console: true,
};

/**
 * Two origins, as in production (issue #718): the app, app.bindersnap.com,
 * on APP_PORT, and the public site, bindersnap.com, on SITE_PORT. Each links
 * to the other through BUN_PUBLIC_APP_URL and BUN_PUBLIC_SITE_URL, which
 * docker-compose.yml sets.
 */
serve({
  port: appPort,
  routes: {
    ...publicFiles,
    "/*": appIndex,
  },
  development,
});

serve({
  port: sitePort,
  routes: {
    ...publicFiles,
    ...siteRoutes,
    "/help": serveHelp,
    "/help/*": serveHelp,
    "/legal": serveLegal,
    "/legal/*": serveLegal,
    "/": landingIndex,
  },
  fetch: siteNotFound,
  development,
});

console.log(`🚀 App running at http://localhost:${appPort}/`);
console.log(`🌐 Site running at http://localhost:${sitePort}/`);
