/**
 * The uptime Worker's entry point. A cron trigger runs it every minute; it has
 * no fetch handler and no route. All of the logic is in `check.ts`, which the
 * tests import; this file only binds it to Cloudflare's runtime.
 */

import { EmailMessage } from "cloudflare:email";

import { run, type Env as CheckEnv } from "./check";

interface Env extends CheckEnv {
  /** Email Routing's send_email binding. */
  ALERT_EMAIL: { send(message: EmailMessage): Promise<void> };
}

export default {
  scheduled(
    _controller: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): void {
    ctx.waitUntil(
      run(env, (from, to, raw) =>
        env.ALERT_EMAIL.send(new EmailMessage(from, to, raw)),
      ),
    );
  },
};
