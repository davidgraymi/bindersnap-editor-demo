# Feedback Worker

`POST https://feedback.bindersnap.com/` with a report from the app's
**Send feedback** dialog, and an issue opens in the private
`davidgraymi/bindersnap-feedback` repository, filed by a GitHub App.

Why it is a Worker, and what it may never become, is
[ADR 0006](../../docs/adr/0006-cloudflare-workers-at-the-edge.md). In short:
it keeps nothing, it is off the critical path, and it never talks to Gitea or
the API.

| File               | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `src/index.ts`     | The request: origin, rate limit, size, shape, Turnstile, GitHub |
| `src/schema.ts`    | The check, typed against `packages/utils/feedbackReport.ts`     |
| `src/issue.ts`     | A report written as an issue; every browser value escaped       |
| `src/github.ts`    | The app's JWT → its installation → a token → the issue          |
| `src/turnstile.ts` | Turnstile's siteverify                                          |
| `wrangler.jsonc`   | Name, custom domain, variables, the rate limit                  |

Tests run with the rest: `bun run test:ops`, or `bun test services/feedback`.

## Setting it up, once

The deploy workflow cannot do these; they need a person with the accounts.
Merge first: `feedback-worker.yml` creates the Worker on its first run, and a
secret can only be set on a Worker that exists. Until the secrets are in,
every report answers 502 and nothing else is affected.

1. **The repository.** Create `davidgraymi/bindersnap-feedback`, **private**.
   Reports can hold patient names and policy text.
2. **The GitHub App.** GitHub → Settings → Developer settings → GitHub Apps →
   New. Name it `bindersnap-feedback`. No webhook, no callback URL.
   Repository permissions: **Issues: Read and write**, nothing else (Metadata:
   read is added for you). Install it on the feedback repository **only**.
   Note the App ID and generate a private key (a `.pem` download).
3. **The App's secrets.** From the repository root, with a Cloudflare token
   that can edit Workers:

   ```bash
   cd services/feedback
   echo -n "<app id>" | bunx wrangler@4.149.0 secret put GITHUB_APP_ID
   bunx wrangler@4.149.0 secret put GITHUB_APP_PRIVATE_KEY < ~/Downloads/bindersnap-feedback.*.private-key.pem
   rm ~/Downloads/bindersnap-feedback.*.private-key.pem
   ```

4. **Turnstile.** `CLOUDFLARE_ACCOUNT_ID=… ./put-turnstile-secret.sh` creates
   the widget (or finds it), sets `TURNSTILE_SECRET_KEY` on the Worker, and
   prints the site key. The site key is public: set it as the
   `TURNSTILE_SITE_KEY` variable of the GitHub `production` environment, then
   re-run `static-site.yml` so the app picks it up.

Check it: `curl -si -X OPTIONS -H 'Origin: https://bindersnap.com'
https://feedback.bindersnap.com/` answers 204, then send one from the app and
watch the issue appear.

## Trying it locally

`bunx wrangler@4.149.0 dev` runs it on `localhost:8787`, which collides with
the API in a running stack; pass `--port`. Put development secrets in
`services/feedback/.dev.vars` (gitignored): Turnstile's always-pass secret
`1x0000000000000000000000000000000AA` and an App installed on a scratch
repository. Add your local app origin to `ALLOWED_ORIGINS` there too.
