import { Server } from "@hocuspocus/server";

const server = new Server({
  name: "bindersnap-hocuspocus-dev",
  port: 1234,
  quiet: true,
});

server.listen();

process.on("SIGTERM", () => {
  server.destroy();
});

process.on("SIGINT", () => {
  server.destroy();
});
