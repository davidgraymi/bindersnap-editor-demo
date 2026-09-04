#!/usr/bin/env bun
/**
 * Local stack lifecycle — one isolated Docker Compose stack per worktree.
 *
 * The problem this solves: `docker-compose.yml` names its project, its
 * network, its volumes and every published port after `STACK_NAME` and the
 * `*_PORT` variables, all of which fall back to a single shared default. A
 * worktree without a `.env` therefore resolves to the *same* project as the
 * main checkout, so `docker compose up` collides on every port and
 * `docker compose down` tears down somebody else's running stack.
 *
 * This script makes that impossible. Every command first claims a port block
 * for the current worktree from a machine-wide registry under
 * `~/.bindersnap/`, writes it to that worktree's `.env`, and passes the
 * resolved values to compose explicitly. Two agents in two worktrees get two
 * stacks that cannot see or destroy each other, with no manual setup.
 *
 * Commands:
 *   up [--fresh] [--fg]   Start this worktree's stack and wait until ready
 *   down [--clean]        Stop this worktree's stack (never anyone else's)
 *   restart [--fresh]     down + up
 *   status [--all]        What this worktree owns, and whether it is running
 *   logs [service] [-n N] Tail logs from this worktree's stack
 *   ensure                Claim the port block and write .env, nothing else
 *   prune                 Tear down + forget stacks whose worktree is gone
 *
 * `--json` makes `status` and `ensure` machine-readable.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PORT_KEYS = [
  "APP_PORT",
  "API_PORT",
  "API_PROXY_PORT",
  "GITEA_PORT",
  "HOCUSPOCUS_PORT",
] as const;

export type PortKey = (typeof PORT_KEYS)[number];
export type Ports = Record<PortKey, number>;

/**
 * Slot 0 is the main checkout and keeps the historical ports, so a developer
 * who has been typing `localhost:5173` for a year keeps typing it. Every other
 * worktree gets a contiguous block of five ports well clear of the defaults —
 * one block per slot, so a slot number is the only thing that has to be
 * unique.
 */
export const LEGACY_PORTS: Ports = {
  APP_PORT: 5173,
  API_PORT: 8787,
  API_PROXY_PORT: 8788,
  GITEA_PORT: 3000,
  HOCUSPOCUS_PORT: 1234,
};

const SLOT_PORT_BASE = 21000;
const SLOT_STRIDE = 10;
const MAX_SLOT = 64;

const SLOT_OFFSETS: Record<PortKey, number> = {
  APP_PORT: 0,
  API_PORT: 1,
  API_PROXY_PORT: 2,
  GITEA_PORT: 3,
  HOCUSPOCUS_PORT: 4,
};

/**
 * Keys worth inheriting from the main checkout's `.env` when a worktree is
 * first set up. Deliberately excludes anything carrying a port or an origin:
 * those are derived per stack, and a copied one would silently point a
 * worktree's app at another worktree's API.
 */
const INHERITED_KEYS = [
  "GITEA_ADMIN_USER",
  "GITEA_ADMIN_PASS",
  "BINDERSNAP_GITEA_TOKEN_SCOPES",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
] as const;

export function portsForSlot(slot: number): Ports {
  if (slot === 0) return { ...LEGACY_PORTS };
  const base = SLOT_PORT_BASE + slot * SLOT_STRIDE;
  return PORT_KEYS.reduce((acc, key) => {
    acc[key] = base + SLOT_OFFSETS[key];
    return acc;
  }, {} as Ports);
}

/**
 * Compose project names must match `[a-z0-9][a-z0-9_-]*`. The slot suffix
 * keeps two worktrees that happen to share a directory name apart.
 */
export function stackNameFor(root: string, slot: number): string {
  if (slot === 0) return "bindersnap";
  const slug =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "worktree";
  return `bindersnap-${slug}-${slot}`;
}

export interface StackRecord {
  path: string;
  slot: number;
  stackName: string;
  ports: Ports;
  createdAt: string;
}

export interface Registry {
  version: 1;
  stacks: StackRecord[];
}

const EMPTY_REGISTRY: Registry = { version: 1, stacks: [] };

export function stackHome(): string {
  return process.env.BINDERSNAP_STACK_HOME ?? join(homedir(), ".bindersnap");
}

function registryPath(): string {
  return join(stackHome(), "stacks.json");
}

function lockPath(): string {
  return join(stackHome(), "stacks.lock");
}

export function readRegistry(): Registry {
  const file = registryPath();
  if (!existsSync(file)) return { ...EMPTY_REGISTRY, stacks: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Registry;
    if (!parsed || !Array.isArray(parsed.stacks)) {
      return { ...EMPTY_REGISTRY, stacks: [] };
    }
    return parsed;
  } catch {
    // A truncated registry is recoverable: every record is re-derivable from
    // the worktree it names, and losing it costs at most a re-allocation.
    return { ...EMPTY_REGISTRY, stacks: [] };
  }
}

function writeRegistry(registry: Registry): void {
  mkdirSync(stackHome(), { recursive: true });
  const file = registryPath();
  // Write-then-rename so a reader never sees a half-written registry, and a
  // crash mid-write never leaves the machine without one.
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  spawnSync("mv", [tmp, file]);
}

function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 30_000;

/**
 * Cross-process mutex around the registry.
 *
 * `mkdir` is the atomic primitive here: it either creates the directory or
 * fails, with no window in between, on every filesystem this runs on. That is
 * what keeps two agents starting stacks in the same second from claiming the
 * same port block.
 */
export function withLock<T>(fn: () => T): T {
  const lock = lockPath();
  mkdirSync(stackHome(), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // Held by someone else — unless whoever held it died without cleaning
      // up, in which case the lock would wedge every future run.
      let ageMs = 0;
      try {
        ageMs = Date.now() - Number(Bun.file(join(lock, "owner")).lastModified);
      } catch {
        ageMs = LOCK_STALE_MS + 1;
      }
      if (ageMs > LOCK_STALE_MS) {
        try {
          rmSync(lock, { recursive: true, force: true });
        } catch {}
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the stack registry lock at ${lock}. ` +
            `If no other stack command is running, delete that directory.`,
        );
      }
      sleepSync(50);
    }
  }

  try {
    writeFileSync(join(lock, "owner"), `${process.pid}\n`, "utf8");
    return fn();
  } finally {
    try {
      rmSync(lock, { recursive: true, force: true });
    } catch {}
  }
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.once("listening", () => server.close(() => done(true)));
    // 0.0.0.0, matching what compose publishes on: a port bound only on
    // 127.0.0.1 by something else would still collide with a container.
    server.listen(port, "0.0.0.0");
  });
}

async function portsAllFree(ports: Ports): Promise<boolean> {
  for (const key of PORT_KEYS) {
    if (!(await isPortFree(ports[key]))) return false;
  }
  return true;
}

/**
 * Resolve symlinks before comparing or recording a path.
 *
 * git answers with the real path, so on macOS — where `/var` is a symlink to
 * `/private/var` — a checkout under a temp or symlinked directory would
 * otherwise never recognise itself as its own main checkout, and every run
 * would claim a fresh slot.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The main checkout of this repo — the worktree that owns slot 0. */
export function mainCheckout(root: string): string {
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8" },
  );
  const commonDir = result.stdout?.trim();
  if (result.status !== 0 || !commonDir) return canonicalPath(root);
  return canonicalPath(dirname(commonDir));
}

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

// ---------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key) out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const MANAGED_BEGIN =
  "# >>> bindersnap stack (managed by scripts/stack.ts) >>>";
const MANAGED_END = "# <<< bindersnap stack (managed by scripts/stack.ts) <<<";

/**
 * Rewrite only the managed block, leaving everything a human put in the file
 * untouched. Any stray copy of a managed key outside the block is commented
 * out rather than deleted, because a live `APP_PORT=5173` further down the
 * file would override the block and quietly point this worktree at another
 * stack.
 */
export function renderEnv(
  existing: string,
  managed: Record<string, string>,
): string {
  const block = [
    MANAGED_BEGIN,
    "# Regenerate with `bun run stack ensure`. Edit ports here only if you",
    "# also free the ones you are leaving behind.",
    ...Object.entries(managed).map(([k, v]) => `${k}=${v}`),
    MANAGED_END,
  ].join("\n");

  const managedKeys = new Set(Object.keys(managed));
  const withoutBlock = stripManagedBlock(existing);
  const neutralised = withoutBlock
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return line;
      const key = trimmed.slice(0, eq).trim();
      return managedKeys.has(key)
        ? `# superseded by the managed stack block below: ${trimmed}`
        : line;
    })
    .join("\n");

  const head = neutralised.trim();
  return head ? `${head}\n\n${block}\n` : `${block}\n`;
}

function stripManagedBlock(text: string): string {
  const start = text.indexOf(MANAGED_BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(MANAGED_END, start);
  if (end === -1) return text.slice(0, start);
  return text.slice(0, start) + text.slice(end + MANAGED_END.length);
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export interface StackConfig extends StackRecord {
  envPath: string;
  allocated: boolean;
}

/**
 * Claim (or re-claim) this worktree's slot and write its `.env`.
 *
 * Idempotent: a worktree that already owns a slot keeps it, so ports stay
 * stable across sessions and an agent can restart a stack it did not start.
 */
export async function ensureStackEnv(
  root: string = repoRoot(),
): Promise<StackConfig> {
  const path = canonicalPath(root);
  const main = mainCheckout(path);

  const claim = await claimSlot(path, main);
  const record: StackRecord = claim.record;
  const envPath = join(path, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

  const managed: Record<string, string> = {
    STACK_NAME: record.stackName,
    ...Object.fromEntries(
      PORT_KEYS.map((key) => [key, String(record.ports[key])]),
    ),
  };

  // A brand-new worktree starts from the main checkout's non-port settings so
  // that Stripe test keys and admin credentials are not something every agent
  // has to rediscover.
  let seeded = existing;
  if (!existing.trim() && main !== path) {
    const mainEnvPath = join(main, ".env");
    if (existsSync(mainEnvPath)) {
      const mainEnv = parseEnv(readFileSync(mainEnvPath, "utf8"));
      const inherited = INHERITED_KEYS.filter((k) => mainEnv[k]).map(
        (k) => `${k}=${mainEnv[k]}`,
      );
      if (inherited.length > 0) {
        seeded = [
          `# Inherited from ${mainEnvPath} when this worktree was first set up.`,
          ...inherited,
          "",
        ].join("\n");
      }
    }
  }

  writeFileSync(envPath, renderEnv(seeded, managed), "utf8");

  return { ...record, envPath, allocated: claim.allocated };
}

async function claimSlot(
  path: string,
  main: string,
): Promise<{ record: StackRecord; allocated: boolean }> {
  // Port probing is async and must not happen while the lock is held for a
  // long time, so candidates are probed first and the registry is then
  // re-checked under the lock before the winner is committed.
  const existingRecord = withLock(() => {
    const registry = pruneMissing(readRegistry());
    writeRegistry(registry);
    return registry.stacks.find((s) => s.path === path) ?? null;
  });

  if (existingRecord) {
    const stackName = stackNameFor(path, existingRecord.slot);
    return {
      record: { ...existingRecord, stackName },
      allocated: false,
    };
  }

  // Slot 0 — the historical ports — belongs to the main checkout, but only if
  // nothing else already holds it. A second *clone* of the repo is also a
  // "main checkout" by this test, and handing it slot 0 as well would put two
  // stacks on port 5173.
  const slotZeroHeld = readRegistry().stacks.some(
    (s) => s.slot === 0 && s.path !== path,
  );

  if (path === main && !slotZeroHeld) {
    const record: StackRecord = {
      path,
      slot: 0,
      stackName: stackNameFor(path, 0),
      ports: portsForSlot(0),
      createdAt: new Date().toISOString(),
    };
    withLock(() => {
      const registry = readRegistry();
      if (!registry.stacks.some((s) => s.path === path)) {
        registry.stacks.push(record);
        writeRegistry(registry);
      }
    });
    return { record, allocated: true };
  }

  for (let slot = 1; slot <= MAX_SLOT; slot++) {
    const taken = readRegistry().stacks.some((s) => s.slot === slot);
    if (taken) continue;

    const ports = portsForSlot(slot);
    if (!(await portsAllFree(ports))) continue;

    const committed = withLock(() => {
      const registry = pruneMissing(readRegistry());
      // Re-check under the lock: another agent may have claimed this slot
      // while this one was probing ports.
      if (registry.stacks.some((s) => s.slot === slot)) return null;
      const mine = registry.stacks.find((s) => s.path === path);
      if (mine) return mine;
      const record: StackRecord = {
        path,
        slot,
        stackName: stackNameFor(path, slot),
        ports,
        createdAt: new Date().toISOString(),
      };
      registry.stacks.push(record);
      writeRegistry(registry);
      return record;
    });

    if (committed) return { record: committed, allocated: true };
  }

  throw new Error(
    `No free stack slot in 1..${MAX_SLOT}. Run \`bun run stack prune\` to ` +
      `release slots whose worktrees are gone.`,
  );
}

/** Drop records whose worktree directory no longer exists. */
export function pruneMissing(registry: Registry): Registry {
  return {
    ...registry,
    stacks: registry.stacks.filter((s) => existsSync(s.path)),
  };
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

function composeEnv(config: StackConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STACK_NAME: config.stackName,
    ...Object.fromEntries(
      PORT_KEYS.map((key) => [key, String(config.ports[key])]),
    ),
  };
}

function compose(
  config: StackConfig,
  args: string[],
  opts: { stdio?: "inherit" | "pipe" } = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    "docker",
    ["compose", "-f", join(config.path, "docker-compose.yml"), ...args],
    {
      cwd: config.path,
      // The project name on the command line, not just in the environment:
      // it is the one thing standing between this command and another
      // worktree's containers.
      env: composeEnv(config),
      stdio: opts.stdio ?? "inherit",
      encoding: "utf8",
    },
  ) as SpawnSyncReturns<string>;
}

function log(message: string): void {
  process.stdout.write(`[stack] ${message}\n`);
}

function requireDocker(): void {
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker is not running. Start Docker Desktop and retry.");
  }
}

async function waitForUrl(
  url: string,
  { attempts = 90, delayMs = 2000, ok = (r: Response) => r.status < 500 } = {},
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (ok(await fetch(url))) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Timed out after ${(attempts * delayMs) / 1000}s waiting for ${url}`,
  );
}

export interface StackUrls {
  app: string;
  api: string;
  apiProxy: string;
  gitea: string;
  hocuspocus: string;
}

export function urlsFor(config: StackConfig): StackUrls {
  const p = config.ports;
  return {
    app: `http://localhost:${p.APP_PORT}`,
    api: `http://localhost:${p.API_PORT}`,
    apiProxy: `http://localhost:${p.API_PROXY_PORT}`,
    gitea: `http://localhost:${p.GITEA_PORT}`,
    hocuspocus: `ws://localhost:${p.HOCUSPOCUS_PORT}`,
  };
}

/**
 * The password the seed job gave every demo account.
 *
 * It is `GITEA_ADMIN_PASS`, not the `dev` that the docs assume: a worktree
 * inherits that key from the main checkout, where it is often something else,
 * and an agent that reports the wrong one sends the next session hunting a
 * login failure that is not a bug.
 */
export function seedPassword(config: StackConfig): string {
  const envPath = join(config.path, ".env");
  if (existsSync(envPath)) {
    const parsed = parseEnv(readFileSync(envPath, "utf8"));
    if (parsed.GITEA_ADMIN_PASS) return parsed.GITEA_ADMIN_PASS;
  }
  return "dev";
}

export function isRunning(config: StackConfig): boolean {
  const result = spawnSync(
    "docker",
    ["compose", "-p", config.stackName, "ps", "--quiet"],
    { encoding: "utf8", env: composeEnv(config) },
  );
  return (result.stdout ?? "").trim().length > 0;
}

function reportFailure(config: StackConfig): void {
  const ps = compose(config, ["ps", "-a"], { stdio: "pipe" });
  process.stderr.write(`${ps.stdout ?? ""}\n`);
  const exited = compose(
    config,
    ["ps", "-a", "--status", "exited", "--services"],
    { stdio: "pipe" },
  );
  const services = (exited.stdout ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const service of services.length > 0 ? services : ["seed", "api"]) {
    const logs = compose(
      config,
      ["logs", "--no-color", "--tail", "60", service],
      {
        stdio: "pipe",
      },
    );
    process.stderr.write(`\n--- ${service} ---\n${logs.stdout ?? ""}\n`);
  }
}

async function cmdUp(args: string[]): Promise<void> {
  requireDocker();
  const config = await ensureStackEnv();
  const fresh = args.includes("--fresh");
  const foreground = args.includes("--fg") || args.includes("--foreground");

  log(`stack ${config.stackName} (slot ${config.slot}) in ${config.path}`);

  if (fresh) {
    log("--fresh: removing containers, volumes and seeded Gitea data");
    compose(config, ["down", "-v", "--remove-orphans"], { stdio: "pipe" });
    rmSync(join(config.path, "data", "gitea"), {
      recursive: true,
      force: true,
    });
  }

  if (foreground) {
    // Escape hatch for a human who wants the log stream. Never for an agent:
    // it does not exit.
    compose(config, ["up", "--build"]);
    return;
  }

  log("docker compose up --build -d ...");
  const up = compose(config, ["up", "--build", "-d"]);
  if (up.status !== 0) {
    reportFailure(config);
    throw new Error("docker compose up failed — see the logs above.");
  }

  const urls = urlsFor(config);
  log(`waiting for Gitea at ${urls.gitea} ...`);
  await waitForUrl(`${urls.gitea}/`);
  log(`waiting for the API at ${urls.api}/auth/me ...`);
  await waitForUrl(`${urls.api}/auth/me`);
  log(`waiting for the Caddy proxy at ${urls.apiProxy}/auth/me ...`);
  await waitForUrl(`${urls.apiProxy}/auth/me`);
  log(`waiting for the app at ${urls.app} ...`);
  await waitForUrl(urls.app, { ok: (r) => r.ok });

  process.stdout.write(
    [
      "",
      `  Stack ready: ${config.stackName}`,
      "",
      `    App        ${urls.app}`,
      `    API        ${urls.api}`,
      `    API proxy  ${urls.apiProxy}`,
      `    Gitea      ${urls.gitea}`,
      `    Hocuspocus ${urls.hocuspocus}`,
      "",
      `    Sign in as alice, bob, carol or dan — password \`${seedPassword(config)}\`.`,
      "",
      `    Tests:   SKIP_STACK=1 bun run test:integration`,
      `    Logs:    bun run stack logs api`,
      `    Stop:    bun run down`,
      "",
    ].join("\n"),
  );
}

async function cmdDown(args: string[]): Promise<void> {
  requireDocker();
  const config = await ensureStackEnv();
  log(`tearing down ${config.stackName} (slot ${config.slot}) only`);
  const result = compose(config, ["down", "-v", "--remove-orphans"]);
  if (args.includes("--clean")) {
    rmSync(join(config.path, "data", "gitea"), {
      recursive: true,
      force: true,
    });
    log("removed seeded Gitea data");
  }
  if (result.status !== 0) {
    throw new Error("docker compose down exited non-zero.");
  }
  log("down");
}

async function cmdStatus(args: string[]): Promise<void> {
  const config = await ensureStackEnv();
  const running =
    spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
      ? isRunning(config)
      : false;
  const urls = urlsFor(config);

  if (args.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          stackName: config.stackName,
          slot: config.slot,
          path: config.path,
          ports: config.ports,
          urls,
          running,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(
    [
      `  stack   ${config.stackName}`,
      `  slot    ${config.slot}`,
      `  path    ${config.path}`,
      `  state   ${running ? "running" : "stopped"}`,
      `  app     ${urls.app}`,
      `  api     ${urls.api} (proxy ${urls.apiProxy})`,
      `  gitea   ${urls.gitea}`,
      `  login   alice / bob / carol / dan — password \`${seedPassword(config)}\``,
      "",
    ].join("\n"),
  );

  if (args.includes("--all")) {
    process.stdout.write("  all registered stacks:\n");
    for (const record of pruneMissing(readRegistry()).stacks) {
      const mark = record.path === config.path ? "*" : " ";
      process.stdout.write(
        `   ${mark} slot ${String(record.slot).padStart(2)}  ${record.stackName}  app :${record.ports.APP_PORT}  ${record.path}\n`,
      );
    }
    process.stdout.write("\n");
  }
}

async function cmdLogs(args: string[]): Promise<void> {
  const config = await ensureStackEnv();
  const tailIdx = args.findIndex((a) => a === "-n" || a === "--tail");
  const tail = tailIdx === -1 ? "80" : (args[tailIdx + 1] ?? "80");
  const service = args.find((a) => !a.startsWith("-") && a !== tail);
  compose(config, [
    "logs",
    "--no-color",
    "--tail",
    tail,
    ...(service ? [service] : []),
  ]);
}

async function cmdEnsure(args: string[]): Promise<void> {
  const config = await ensureStackEnv();
  if (args.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify(
        { stackName: config.stackName, slot: config.slot, ports: config.ports },
        null,
        2,
      )}\n`,
    );
    return;
  }
  log(
    `${config.allocated ? "allocated" : "reusing"} slot ${config.slot} — ` +
      `${config.stackName}, app on :${config.ports.APP_PORT} (wrote ${config.envPath})`,
  );
}

async function cmdPrune(): Promise<void> {
  const registry = readRegistry();
  const gone = registry.stacks.filter((s) => !existsSync(s.path));
  for (const record of gone) {
    log(`releasing slot ${record.slot} — ${record.path} is gone`);
    spawnSync(
      "docker",
      ["compose", "-p", record.stackName, "down", "-v", "--remove-orphans"],
      {
        stdio: "inherit",
      },
    );
  }
  withLock(() => writeRegistry(pruneMissing(readRegistry())));
  log(`released ${gone.length} slot(s)`);
}

const USAGE = `bun run stack <command>

  up [--fresh] [--fg]   start this worktree's stack, wait until it is ready
  down [--clean]        stop this worktree's stack (never another worktree's)
  restart [--fresh]     down, then up
  status [--all] [--json]
  logs [service] [-n N]
  ensure [--json]       claim a port block and write .env, start nothing
  prune                 release slots whose worktrees no longer exist
`;

async function main(): Promise<void> {
  const [command = "status", ...args] = process.argv.slice(2);
  switch (command) {
    case "up":
    case "start":
      return cmdUp(args);
    case "down":
    case "stop":
      return cmdDown(args);
    case "restart":
      await cmdDown(args);
      return cmdUp(args);
    case "status":
    case "ps":
      return cmdStatus(args);
    case "logs":
      return cmdLogs(args);
    case "ensure":
    case "env":
      return cmdEnsure(args);
    case "prune":
      return cmdPrune();
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`[stack] ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
