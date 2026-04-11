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
    "/login": appIndex,
    "/login/*": appIndex,
    "/auth/callback": appIndex,
    "/docs/*": appIndex,
    "/*": appIndex,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 App server running at http://localhost:${appPort}/`);
