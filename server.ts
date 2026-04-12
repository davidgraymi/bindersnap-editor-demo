import { serve } from "bun";
import appIndex from "./apps/app/index.html";

const configuredPort = Number.parseInt(
  process.env.PORT ?? process.env.APP_PORT ?? "5173",
  10,
);
const appPort =
  Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5173;

const server = serve({
  port: appPort,
  routes: {
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
