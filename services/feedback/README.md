# Feedback Worker

`POST https://feedback.bindersnap.com/` with a report from the app's
**Send feedback** dialog, and an issue opens in the private
`davidgraymi/bindersnap-feedback` repository, filed by a GitHub App.

`POST https://feedback.bindersnap.com/errors` with an error report from the
app or the API, and the same App opens an issue in the private
`davidgraymi/bindersnap-errors` repository, or comments on the one already
there.

Why it is a Worker, and what it may never become, is
[ADR 0006](../../docs/adr/0006-cloudflare-workers-at-the-edge.md). In short:
it keeps nothing, it is off the critical path, and it never talks to Gitea or
the API.

| File                 | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `src/index.ts`       | The request: origin, rate limit, size, shape, Turnstile, GitHub |
| `src/schema.ts`      | The check, typed against `packages/utils/feedbackReport.ts`     |
| `src/issue.ts`       | A report written as an issue; every browser value escaped       |
| `src/errors.ts`      | `/errors`: sender, limits, scrub, fingerprint, file or comment  |
| `src/errorSchema.ts` | The check, typed against `packages/utils/errorReport.ts`        |
| `src/errorIssue.ts`  | An error written as an issue, and each later one as a comment   |
| `src/github.ts`      | The app's JWT → its installation → a token → the issues         |
| `src/http.ts`        | CORS, replies, a capped body, the log line                      |
| `src/turnstile.ts`   | Turnstile's siteverify                                          |
| `wrangler.jsonc`     | Name, custom domain, variables, the rate limit                  |

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
   that can edit Workers. GitHub's key is PKCS#1 and the Worker's JWT library
   accepts only PKCS#8, so convert it on the way in; uploaded as it comes,
   every report answers 502:

   ```bash
   cd services/feedback
   echo -n "<app id>" | bunx wrangler@4.149.0 secret put GITHUB_APP_ID
   openssl pkcs8 -topk8 -nocrypt -in ~/Downloads/bindersnap-feedback.*.private-key.pem |
     bunx wrangler@4.149.0 secret put GITHUB_APP_PRIVATE_KEY
   rm ~/Downloads/bindersnap-feedback.*.private-key.pem
   ```

4. **Turnstile.** `CLOUDFLARE_ACCOUNT_ID=… ./put-turnstile-secret.sh` creates
   the widget (or finds it), sets `TURNSTILE_SECRET_KEY` on the Worker, and
   prints the site key. The site key is public: set it as the
   `TURNSTILE_SITE_KEY` variable of the GitHub `production` environment, then
   re-run `static-site.yml` so the app picks it up.

5. **Errors.** Create `davidgraymi/bindersnap-errors`, **private**, and add
   it to the GitHub App's installation (GitHub → Settings → Applications →
   `bindersnap-feedback` → Configure → Only select repositories). Then give
   the Worker and the API the same secret, which the API sends as its bearer:

   ```bash
   secret="$(openssl rand -hex 32)"
   printf '%s' "$secret" | bunx wrangler@4.149.0 secret put ERROR_REPORT_SECRET
   printf '%s' "$secret" | aws ssm put-parameter --overwrite --type SecureString \
     --key-id alias/bindersnap-prod-ssm --name /bindersnap/prod/error_report_secret \
     --value file:///dev/stdin
   unset secret
   ```

   The next deploy renders it into the API's environment. Until the repository
   exists, every error report answers 502 and nothing else is affected; until
   the secret is set, the API's reports are refused and the app's still work.

Check it: `curl -si -X OPTIONS -H 'Origin: https://app.bindersnap.com'
https://feedback.bindersnap.com/` answers 204, then send one from the app and
watch the issue appear.

## Errors: what a triager does

- **Read** the issue: the error, which kind of page or which part of the API,
  the app's version, and the API's request IDs. Each request ID finds every
  log line for that request in CloudWatch.
- **Mute** an error by closing its issue as _not planned_. It stops writing.
- **Fix** it and close it as _completed_. If it happens again, the issue
  reopens with a `regression` label.

The fingerprint at the end of the title is how the next occurrence finds the
issue. Don't edit it out.

## Trying it locally

`bunx wrangler@4.149.0 dev` runs it on `localhost:8787`, which collides with
the API in a running stack; pass `--port`. Put development secrets in
`services/feedback/.dev.vars` (gitignored): Turnstile's always-pass secret
`1x0000000000000000000000000000000AA` and an App installed on a scratch
repository. Add your local app origin to `ALLOWED_ORIGINS` there too.
