import { serve } from "bun";
import index from "../../apps/landing/index.html";

const configuredPort = Number.parseInt(
  process.env.PORT ?? process.env.LANDING_PORT ?? "5174",
  10,
);
const landingPort =
  Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 5174;

const server = serve({
  port: landingPort,
  routes: {
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Landing server running at http://localhost:${landingPort}/`);
