/**
 * Playwright globalSetup — manages the Docker Compose integration stack.
 *
 * Invoked automatically by Playwright before any test file runs.
 * Brings up the full stack (Gitea + seed + Hocuspocus + API + app),
 * waits until the app is reachable, then lets Playwright proceed.
 *
 * The companion globalTeardown tears everything down after the run.
 *
 * Environment variables (all optional — defaults match docker-compose.yml):
 *   APP_PORT        App container port (default: 5173)
 *   SKIP_STACK      Set to "1" to skip docker compose entirely (use an
 *                   already-running stack, e.g. from `bun run up`)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSE_FILE = resolve(ROOT, "docker-compose.yml");
const APP_PORT = process.env.APP_PORT ?? "5173";
const APP_BASE_URL = `http://localhost:${APP_PORT}`;

function log(message: string): void {
  process.stdout.write(`[global-setup] ${message}\n`);
}

function composeDown(): void {
  spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "down", "-v", "--remove-orphans"],
    { stdio: "ignore", env: { ...process.env, APP_PORT } },
  );
}

function runComposeCommand(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    stdio: "pipe",
    encoding: "utf8",
    env: { ...process.env, APP_PORT },
  });
}

function printComposeOutput(label: string, output?: string | null): void {
  const trimmed = output?.trim();
  if (!trimmed) {
    return;
  }

  process.stderr.write(`[global-setup] ${label}\n${trimmed}\n`);
}

function collectFailedServiceLogs(): void {
  const ps = runComposeCommand(["ps", "-a"]);
  printComposeOutput("docker compose ps -a", ps.stdout);
  printComposeOutput("docker compose ps -a stderr", ps.stderr);

  const exitedServices = runComposeCommand([
    "ps",
    "-a",
    "--status",
    "exited",
    "--services",
  ]);

  const serviceNames = new Set(
    (exitedServices.stdout ?? "")
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );

  if (serviceNames.size === 0) {
    serviceNames.add("seed");
  }

  for (const service of serviceNames) {
    const logs = runComposeCommand(["logs", "--no-color", service]);
    printComposeOutput(`docker compose logs ${service}`, logs.stdout);
    printComposeOutput(`docker compose logs ${service} stderr`, logs.stderr);
  }
}

async function waitForUrl(
  url: string,
  attempts: number,
  delayMs: number,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Connection refused or similar — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Timed out after ${attempts * delayMs}ms waiting for ${url} to become reachable.`,
  );
}

export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_STACK === "1") {
    log("SKIP_STACK=1 — assuming stack is already running.");
    return;
  }

  if (!existsSync(COMPOSE_FILE)) {
    throw new Error(`docker-compose.yml not found at: ${COMPOSE_FILE}`);
  }

  // Verify docker is available before attempting anything.
  const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (dockerCheck.status !== 0) {
    throw new Error(
      "Docker is not running or not installed. Start Docker and retry.",
    );
  }

  log("Tearing down any previous stack...");
  composeDown();

  log("Starting integration stack (docker compose up --build -d)...");
  const up = spawnSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "up", "--build", "-d"],
    {
      stdio: "inherit",
      env: { ...process.env, APP_PORT },
    },
  );

  if (up.status !== 0) {
    log("docker compose up failed. Collecting logs from exited services...");
    collectFailedServiceLogs();
    throw new Error("docker compose up failed — see output above.");
  }

  log(`Waiting for app at ${APP_BASE_URL} ...`);
  // Allow up to 120s (60 attempts × 2s) for first-run image pulls + Gitea init.
  await waitForUrl(APP_BASE_URL, 60, 2000);
  log("Stack is ready.");
}
