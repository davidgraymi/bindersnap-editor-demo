# Uptime Worker

Every minute, `GET https://api.bindersnap.com/healthz` from Cloudflare. After
two failed checks in a row, one email says the API is down. When it answers
200 again, one more says it is back. Nothing in between.

It goes the way a browser does (Cloudflare → tunnel → Caddy → API), so it
catches what the CloudWatch alarms in `infra/monitoring` cannot: a healthy
instance whose API, Caddy or tunnel is broken. It costs nothing on the free
plan: a cron trigger, one KV read a minute, a KV write only when the result
changes, and Email Routing's `send_email`.

What it cannot see is Cloudflare itself being down, since it runs there. For
that, a free external monitor (Better Stack, UptimeRobot) can be added by hand.

Why it is a Worker, and why it alone may keep a KV key, is
[ADR 0006](../../docs/adr/0006-cloudflare-workers-at-the-edge.md).

| File             | What it does                                                 |
| ---------------- | ------------------------------------------------------------ |
| `src/check.ts`   | The check, the up/down state machine, the email; all tested  |
| `src/worker.ts`  | The cron entry point; binds `send_email` to `check.ts`       |
| `wrangler.jsonc` | Name, schedule, the KV binding, the email binding, variables |

Tests run with the rest: `bun run test:ops`, or `bun test services/uptime`.

## Setting it up, once

1. **The deploy token.** `uptime-worker.yml` uses the `production`
   environment's `CLOUDFLARE_API_TOKEN`, the one the feedback Worker uses. On
   top of what that one has, it needs **Account → Workers KV Storage: Edit**,
   so the first deploy can create the `bindersnap-uptime-state` namespace.
2. **Merge.** The workflow creates the Worker and its namespace on its first
   run. Until step 3, every check runs but an outage email fails (the run
   logs the error), and the next run tries again.
3. **Where alerts go.** The address must already be a **verified** Email
   Routing destination: `email_routing_destination` in `infra/edge` is. From
   the repository root, with a token that can edit Workers:

   ```bash
   cd services/uptime
   echo -n "<verified address>" | bunx wrangler@4.149.0 secret put ALERT_TO
   ```

Check it: Workers → `bindersnap-uptime` → Logs shows one line a minute with
`"ok":true`. To see an email, set `HEALTHZ_URL` to a path that 404s in the
dashboard (Settings → Variables), wait two minutes, then put it back and wait
for the recovery email. The next deploy restores the variable anyway.

## How it decides

- **Down:** two failed checks in a row (`FAILURES_BEFORE_ALERT`). Anything but
  a 200 within 10 s is a failure, including redirects. A deploy's API restart
  takes seconds and never reaches it.
- **While down:** no writes, no emails.
- **Up:** the first 200 after a down email.
- **If an email fails**, the state is not written, so the next run sends it.
- **KV is eventually consistent** across Cloudflare locations, and cron runs
  are not pinned to one. Rarely, a run reads a value a minute old and sends
  one duplicate email.
