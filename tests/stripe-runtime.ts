import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export const STRIPE_RUNTIME_DIR = resolve(
  ROOT,
  "test-results",
  "playwright",
  "stripe-runtime",
);
export const STRIPE_RUNTIME_STATE_PATH = resolve(
  STRIPE_RUNTIME_DIR,
  "state.json",
);
export const STRIPE_RUNTIME_LOG_PATH = resolve(
  STRIPE_RUNTIME_DIR,
  "stripe-listen.log",
);
export const STRIPE_CLI_HOME = resolve(STRIPE_RUNTIME_DIR, "home");
export const STRIPE_CLI_XDG_CONFIG_HOME = resolve(
  STRIPE_RUNTIME_DIR,
  "xdg-config",
);

export interface StripeRuntimeState {
  webhookSecret: string | null;
  listenerPid: number | null;
  listenerReady: boolean;
  listenerError: string | null;
  logPath: string;
  startedAt: string | null;
}

interface EnsureStripeWebhookSecretOptions {
  env: NodeJS.ProcessEnv;
  forwardTo: string;
  log: (message: string) => void;
}

interface StopStripeWebhookSecretRuntimeOptions {
  log: (message: string) => void;
}

export function ensureStripeRuntimeDir(): void {
  mkdirSync(STRIPE_RUNTIME_DIR, { recursive: true });
  mkdirSync(STRIPE_CLI_HOME, { recursive: true });
  mkdirSync(STRIPE_CLI_XDG_CONFIG_HOME, { recursive: true });
}

export function readStripeRuntimeState(): StripeRuntimeState {
  if (!existsSync(STRIPE_RUNTIME_STATE_PATH)) {
    return {
      webhookSecret: null,
      listenerPid: null,
      listenerReady: false,
      listenerError: null,
      logPath: STRIPE_RUNTIME_LOG_PATH,
      startedAt: null,
    };
  }

  try {
    const raw = readFileSync(STRIPE_RUNTIME_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StripeRuntimeState>;

    return {
      webhookSecret:
        typeof parsed.webhookSecret === "string" &&
        parsed.webhookSecret.trim() !== ""
          ? parsed.webhookSecret.trim()
          : null,
      listenerPid:
        typeof parsed.listenerPid === "number" ? parsed.listenerPid : null,
      listenerReady: parsed.listenerReady === true,
      listenerError:
        typeof parsed.listenerError === "string" &&
        parsed.listenerError.trim() !== ""
          ? parsed.listenerError
          : null,
      logPath:
        typeof parsed.logPath === "string" && parsed.logPath.trim() !== ""
          ? parsed.logPath
          : STRIPE_RUNTIME_LOG_PATH,
      startedAt:
        typeof parsed.startedAt === "string" && parsed.startedAt.trim() !== ""
          ? parsed.startedAt
          : null,
    };
  } catch {
    return {
      webhookSecret: null,
      listenerPid: null,
      listenerReady: false,
      listenerError: "Could not read Stripe runtime state.",
      logPath: STRIPE_RUNTIME_LOG_PATH,
      startedAt: null,
    };
  }
}

export function writeStripeRuntimeState(
  state: Partial<StripeRuntimeState>,
): void {
  ensureStripeRuntimeDir();
  const nextState = {
    ...readStripeRuntimeState(),
    ...state,
  };
  writeFileSync(
    STRIPE_RUNTIME_STATE_PATH,
    JSON.stringify(nextState, null, 2),
    "utf8",
  );
}

export function clearStripeRuntimeState(): void {
  rmSync(STRIPE_RUNTIME_STATE_PATH, { force: true });
  rmSync(STRIPE_RUNTIME_LOG_PATH, { force: true });
}

export function resolveStripeWebhookSecret(): string {
  const fromRuntime = readStripeRuntimeState().webhookSecret;
  if (fromRuntime) {
    return fromRuntime;
  }

  return (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
}

function createStripeCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    HOME: STRIPE_CLI_HOME,
    XDG_CONFIG_HOME: STRIPE_CLI_XDG_CONFIG_HOME,
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForStripeWebhookSecret(
  pid: number,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const logOutput = readFileSync(STRIPE_RUNTIME_LOG_PATH, "utf8");
    const match = logOutput.match(/whsec_[A-Za-z0-9]+/);
    if (match?.[0]) {
      return match[0];
    }

    if (!isProcessAlive(pid)) {
      throw new Error(
        "Stripe CLI exited before exposing a webhook signing secret. Check the Stripe listener log.",
      );
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(
    "Timed out waiting for Stripe CLI to expose a webhook signing secret.",
  );
}

export async function ensureStripeWebhookSecret(
  options: EnsureStripeWebhookSecretOptions,
): Promise<StripeRuntimeState> {
  const { env, forwardTo, log } = options;
  const stripeSecretKey = (env.STRIPE_SECRET_KEY ?? "").trim();
  const stripePriceId = (env.STRIPE_PRICE_ID ?? "").trim();
  const configuredWebhookSecret = (env.STRIPE_WEBHOOK_SECRET ?? "").trim();

  clearStripeRuntimeState();
  ensureStripeRuntimeDir();

  if (configuredWebhookSecret) {
    writeStripeRuntimeState({
      webhookSecret: configuredWebhookSecret,
      listenerPid: null,
      listenerReady: true,
      listenerError: null,
      logPath: STRIPE_RUNTIME_LOG_PATH,
      startedAt: new Date().toISOString(),
    });
    return readStripeRuntimeState();
  }

  if (!stripeSecretKey || !stripePriceId) {
    writeStripeRuntimeState({
      webhookSecret: null,
      listenerPid: null,
      listenerReady: false,
      listenerError: null,
      logPath: STRIPE_RUNTIME_LOG_PATH,
      startedAt: null,
    });
    return readStripeRuntimeState();
  }

  if (env.SKIP_STACK === "1") {
    writeStripeRuntimeState({
      webhookSecret: null,
      listenerPid: null,
      listenerReady: false,
      listenerError:
        "SKIP_STACK=1 and STRIPE_WEBHOOK_SECRET is unset, so the running API cannot be reconfigured.",
      logPath: STRIPE_RUNTIME_LOG_PATH,
      startedAt: null,
    });
    return readStripeRuntimeState();
  }

  const stripeCheck = spawnSync("stripe", ["version"], {
    stdio: "ignore",
    env: createStripeCliEnv(env),
  });

  if (stripeCheck.status !== 0) {
    throw new Error(
      "Stripe CLI is required for hosted Checkout integration tests, but it is not available.",
    );
  }

  log("Starting Stripe webhook listener...");
  const logFd = openSync(STRIPE_RUNTIME_LOG_PATH, "a");
  const listener = spawn(
    "stripe",
    [
      "listen",
      "--skip-update",
      "--api-key",
      stripeSecretKey,
      "--events",
      "checkout.session.completed,customer.subscription.updated,customer.subscription.deleted",
      "--forward-to",
      forwardTo,
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: createStripeCliEnv(env),
    },
  );
  closeSync(logFd);

  const listenerPid = listener.pid ?? null;
  writeStripeRuntimeState({
    webhookSecret: null,
    listenerPid,
    listenerReady: false,
    listenerError: null,
    logPath: STRIPE_RUNTIME_LOG_PATH,
    startedAt: new Date().toISOString(),
  });

  if (!listenerPid) {
    throw new Error("Stripe CLI started without a PID.");
  }

  try {
    const webhookSecret = await waitForStripeWebhookSecret(listenerPid, 20_000);
    env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    writeStripeRuntimeState({
      webhookSecret,
      listenerPid,
      listenerReady: true,
      listenerError: null,
      logPath: STRIPE_RUNTIME_LOG_PATH,
    });
    log("Stripe webhook listener is ready.");
  } catch (error) {
    writeStripeRuntimeState({
      webhookSecret: null,
      listenerPid,
      listenerReady: false,
      listenerError:
        error instanceof Error ? error.message : "Stripe CLI startup failed.",
      logPath: STRIPE_RUNTIME_LOG_PATH,
    });
    throw error;
  } finally {
    listener.unref();
  }

  return readStripeRuntimeState();
}

export async function stopStripeWebhookSecretRuntime(
  options: StopStripeWebhookSecretRuntimeOptions,
): Promise<StripeRuntimeState> {
  const runtimeState = readStripeRuntimeState();
  const listenerPid = runtimeState.listenerPid;

  if (!listenerPid) {
    clearStripeRuntimeState();
    return readStripeRuntimeState();
  }

  try {
    process.kill(-listenerPid, "SIGTERM");
  } catch {
    try {
      process.kill(listenerPid, "SIGTERM");
    } catch (error) {
      writeStripeRuntimeState({
        listenerReady: false,
        listenerError:
          error instanceof Error
            ? error.message
            : "Could not stop Stripe listener.",
      });
      return readStripeRuntimeState();
    }
  }

  clearStripeRuntimeState();
  options.log("Stopped Stripe webhook listener.");
  return readStripeRuntimeState();
}
