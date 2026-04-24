import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const RUNTIME_DIR = resolve(
  ROOT,
  "test-results",
  "playwright",
  "stripe-runtime",
);
const STATE_PATH = resolve(RUNTIME_DIR, "state.json");

interface StripeRuntimeState {
  webhookSecret: string | null;
  pid: number | null;
}

function readState(): StripeRuntimeState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as StripeRuntimeState;
  } catch {
    return { webhookSecret: null, pid: null };
  }
}

function writeState(state: StripeRuntimeState): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Called by test workers at module-load time to get the webhook signing secret.
 * Reads the state file written by globalSetup, falling back to the env var.
 */
export function resolveStripeWebhookSecret(): string {
  const fromState = readState().webhookSecret;
  if (fromState) return fromState;
  return (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
}

interface EnsureOptions {
  env: NodeJS.ProcessEnv;
  forwardTo: string;
  log: (message: string) => void;
}

/**
 * Starts `stripe listen` and waits for the webhook signing secret, then writes
 * it to the runtime state file so test workers can read it across process
 * boundaries.
 *
 * No-ops silently when Stripe keys are absent — Stripe tests self-skip via
 * `resolveStripeWebhookSecret()` returning "".
 *
 * If STRIPE_WEBHOOK_SECRET is already set in env, uses it directly (no
 * listener process is spawned — useful for SKIP_STACK=1 runs).
 */
export async function ensureStripeWebhookSecret(
  options: EnsureOptions,
): Promise<void> {
  const { env, forwardTo, log } = options;

  const secretKey = (env.STRIPE_SECRET_KEY ?? "").trim();
  const priceId = (env.STRIPE_PRICE_ID ?? "").trim();
  const configuredSecret = (env.STRIPE_WEBHOOK_SECRET ?? "").trim();

  // Remove any leftover state from a previous run.
  rmSync(STATE_PATH, { force: true });
  mkdirSync(RUNTIME_DIR, { recursive: true });

  // Static secret configured — use it directly, no listener needed.
  if (configuredSecret) {
    writeState({ webhookSecret: configuredSecret, pid: null });
    log("Using configured STRIPE_WEBHOOK_SECRET.");
    return;
  }

  // No Stripe keys — skip silently; Stripe tests will self-skip.
  if (!secretKey || !priceId) {
    return;
  }

  const stripeCheck = spawnSync("stripe", ["version"], { stdio: "ignore" });
  if (stripeCheck.status !== 0) {
    throw new Error(
      "Stripe CLI not found. Install it before running Stripe integration tests, or unset STRIPE_SECRET_KEY / STRIPE_PRICE_ID so Stripe-specific suites self-skip.",
    );
  }

  log("Starting Stripe webhook listener...");

  const proc = spawn(
    "stripe",
    [
      "listen",
      "--skip-update",
      "--api-key",
      secretKey,
      "--events",
      "checkout.session.completed,customer.subscription.updated,customer.subscription.deleted",
      "--forward-to",
      forwardTo,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );

  const pid = proc.pid;
  if (!pid) throw new Error("Stripe CLI started without a PID.");

  try {
    const webhookSecret = await new Promise<string>((resolve, reject) => {
      let output = "";

      const handleData = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/whsec_\w+/);
        if (match) resolve(match[0]);
      };

      proc.stdout?.on("data", handleData);
      proc.stderr?.on("data", handleData);

      proc.on("exit", (code) =>
        reject(
          new Error(
            `Stripe CLI exited (code ${code}) before exposing a webhook secret.\nOutput:\n${output}`,
          ),
        ),
      );

      setTimeout(
        () =>
          reject(
            new Error(
              `Timed out waiting for Stripe webhook secret.\nOutput:\n${output}`,
            ),
          ),
        20_000,
      );
    });

    writeState({ webhookSecret, pid });
    env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    log("Stripe webhook listener is ready.");
  } catch (error) {
    writeState({ webhookSecret: null, pid });
    throw error;
  } finally {
    proc.unref();
  }
}

interface StopOptions {
  log: (message: string) => void;
}

/**
 * Terminates the `stripe listen` process and removes the runtime state file.
 */
export function stopStripeWebhookSecretRuntime(options: StopOptions): void {
  const { pid } = readState();
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Best-effort — the process may have already exited.
      }
    }
    options.log("Stopped Stripe webhook listener.");
  }
  rmSync(STATE_PATH, { force: true });
}
