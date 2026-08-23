import { Server } from "@hocuspocus/server";

const DEFAULT_PORT = 1234;

function resolvePort(): number {
  const raw = process.env.HOCUSPOCUS_PORT ?? process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

const server = new Server({
  name: "bindersnap-hocuspocus-dev",
  port: resolvePort(),
  quiet: true,
});

server.listen();

process.on("SIGTERM", () => {
  server.destroy();
});

process.on("SIGINT", () => {
  server.destroy();
});
