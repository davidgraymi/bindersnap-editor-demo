import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync("services/api/Dockerfile", "utf8");
const devComposeFile = readFileSync("docker-compose.yml", "utf8");
const composeFile = readFileSync("docker-compose.prod.yml", "utf8");
const workflow = readFileSync(".github/workflows/build-api.yml", "utf8");
const envExample = readFileSync(".env.prod.example", "utf8");
const readme = readFileSync("README.md", "utf8");

describe("API production image wiring", () => {
  test("builds the API from a dedicated non-root Dockerfile", () => {
    expect(dockerfile).toContain("FROM oven/bun:1 AS deps");
    expect(dockerfile).toContain("bun install --frozen-lockfile --production");
    expect(dockerfile).toContain("FROM oven/bun:1-slim");
    expect(dockerfile).toContain(
      "RUN mkdir -p /var/lib/bindersnap && chown bun:bun /var/lib/bindersnap",
    );
    expect(dockerfile).toContain("COPY --chown=bun:bun services/api ./services/api");
    expect(dockerfile).toContain(
      "COPY --chown=bun:bun packages/gitea-client ./packages/gitea-client",
    );
    expect(dockerfile).toContain("USER bun");
  });

  test("reuses the API Dockerfile for local compose while keeping hot reload", () => {
    expect(devComposeFile).toContain("dockerfile: services/api/Dockerfile");
    expect(devComposeFile).toContain('command: ["bun", "--hot", "services/api/server.ts"]');
    expect(devComposeFile).toContain("- .:/app");
    expect(devComposeFile).toContain("- app-node-modules:/app/node_modules");
  });

  test("uses a tagged GHCR image in production without mounting source", () => {
    expect(composeFile).toContain(
      "image: ghcr.io/davidgraymi/bindersnap-api:${API_TAG:-latest}",
    );
    expect(composeFile).not.toContain("image: oven/bun:1");
    expect(composeFile).not.toContain("- .:/app:ro");
    expect(composeFile).not.toContain('command: ["bun", "services/api/server.ts"]');
  });

  test("publishes an arm64 image from GitHub Actions", () => {
    expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
    expect(workflow).toContain("uses: docker/login-action@v3");
    expect(workflow).toContain("uses: docker/build-push-action@v6");
    expect(workflow).toContain("platforms: linux/arm64");
    expect(workflow).toContain("ghcr.io/${{ env.IMAGE_OWNER }}/bindersnap-api:${{ github.sha }}");
    expect(workflow).toContain("ghcr.io/${{ env.IMAGE_OWNER }}/bindersnap-api:latest");
  });

  test("documents API tag overrides for deploy and rollback", () => {
    expect(envExample).toContain("API_TAG=latest");
    expect(readme).toContain("API_TAG");
    expect(readme).toContain("docker compose -f docker-compose.prod.yml --env-file .env.prod pull api");
    expect(readme).toContain("docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api");
  });
});
