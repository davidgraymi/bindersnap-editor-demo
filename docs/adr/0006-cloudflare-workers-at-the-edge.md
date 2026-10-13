# ADR 0006: Cloudflare Workers at the Edge

Status: Accepted
Date: 2026-10-09
Amended: 2026-10-13, one KV key for the uptime Worker (an exception to rule 1)
Amended: 2026-10-13, error reports through the feedback Worker
Amends: [ADR 0003](0003-single-ec2-host-pyinfra-push-deploys.md) in one place —
what "no serverless" forbids. Everything else in ADR 0003 stands: the API,
Gitea and every database run on one EC2 host, configured by `deploy/`.
Related: [`docs/ops/production-architecture.md`](../ops/production-architecture.md),
which asked for this ADR in its closing section.

## Why This Exists

ADR 0003 removed a half-built Lambda, Aurora and API Gateway backend, and
Non-negotiable #6 has said "no serverless" ever since. The rule was written
against a second backend: two places for state, two deploy models, a database
billing around the clock before launch.

The move to Cloudflare (`production-architecture.md`) put two things on Workers
anyway: `bindersnap.com` and `app.bindersnap.com` are assets-only Workers
(`wrangler.jsonc`, `apps/app/wrangler.jsonc`, `static-site.yml`). That document squared it with the rule by reading "no
serverless" as "no code of ours on serverless", since a static Worker runs
none. That reading holds for static files and fails the first time a Worker
needs a `fetch` handler.

The first one is in-app feedback. A person presses **Send feedback**, writes
what went wrong, and an issue opens in a private GitHub repository with what
the app knew at the time: who, where, the last API calls and their request IDs,
the console errors. Feedback matters most when the product is broken, and the
EC2 host being down is the most broken it gets. A report that travels through
the host fails exactly then.

## Decision

**A Worker may run our code when all five of these hold.** Anything that fails
one of them belongs on the EC2 host, as before.

1. **Stateless.** No KV, D1, Durable Objects, R2 writes, Queues or Cache API
   storage. Nothing to back up, migrate or restore.
2. **Holds no customer content at rest.** It may pass a request through to
   its destination. It keeps nothing.
3. **Off the critical path.** If the Worker vanished, signing in, reading,
   authoring, reviewing, publishing and billing would all still work.
4. **Never touches Gitea or the API's databases**, and holds no Gitea or
   session credential. It is not a second backend, and it cannot become one by
   growing a route at a time.
5. **Configured in the repository, deployed from GitHub Actions.** Its
   `wrangler.jsonc` is checked in, `wrangler deploy` runs from a workflow, and
   its secrets go in with `wrangler secret put` — never in the file, never in
   Terraform state.

Rule 4 matters most. Auth, sessions, the job runner, the email outbox, the
Stripe webhook and anything else that reads or writes evidence or
configuration stays in the BFF. Non-negotiables 1–3 are unchanged.

### One exception to rule 1: the uptime Worker's last result

An uptime check has to remember what it saw last, or it cannot tell a new
outage from one it already reported, and it emails on every failed check. So
the uptime Worker may keep **one Workers KV key** holding the last result of
its `/healthz` check: up or down, the count of consecutive failures, and
since when. Nothing else, and no other Worker.

None of what rule 1 guards against applies: there is nothing in it to back
up, migrate or restore. It holds no customer content (rule 2). Losing it
costs at most one duplicate or missing email, and a fresh namespace starts
correct on the next check. KV's free tier covers it many times over: one read
a minute and a write only when the result changes.

The uptime Worker meets the other four rules. It is off the critical path,
because nothing in the product calls it. It requests the API's public
`/healthz` the way any browser can, with no credentials, and never touches
Gitea. Its config and deploy live in the repository, like the feedback
Worker's.

### Workers today

| Worker                | Code of ours | What it does                                                                                                                     |
| --------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `bindersnap-site`     | none         | Serves `dist/site` (landing, marketing, help, legal) on `bindersnap.com`                                                         |
| `bindersnap-app`      | none         | Serves `dist/app` (the SPA) on `app.bindersnap.com`                                                                              |
| `bindersnap-feedback` | yes          | Turns a feedback report into an issue in the private feedback repo, and an error report into an issue in the private errors repo |
| `bindersnap-uptime`   | yes          | Checks `api.bindersnap.com/healthz` every minute; emails down and up                                                             |

## The Feedback Worker

```
SPA                                         feedback.bindersnap.com
 feedbackTrace (ring buffers, from load)     Worker "bindersnap-feedback"
 "Send feedback" dialog ── POST ───────────►  1. CORS: the app's origins only
   kind, title, description, trace,           2. shape and size checks (64 KB)
   Turnstile token                             3. Turnstile siteverify
                                              4. Rate Limiting binding, per IP
                                              5. GitHub App JWT → installation token
                                              6. POST /repos/{feedback repo}/issues
```

- **Where issues go: a private repository.** The product's repository is
  public, and its customers are healthcare organizations. A bug report can
  carry a patient's name as easily as a typo. Real bugs are moved to the public
  repository by hand, after triage.
- **Who files them: a GitHub App** with Issues read/write on that one
  repository and nothing else. Issues are authored by the app's bot, not by a
  person, and the credential does not expire the way a personal token does.
  [`universal-github-app-jwt`](https://github.com/gr2m/universal-github-app-jwt)
  signs the app's JWT with WebCrypto, including the PKCS#1 key GitHub hands
  out.
- **Who sent it: what the SPA says.** The report carries the signed-in user,
  their organization and role as the SPA knows them, marked as self-reported.
  Nothing signs them. A forged report costs one triage, and if forgery or
  flooding starts, the answer is a signed ticket from the BFF, added then.
- **What it carries.** The trace is structured and visible in the dialog before
  sending: the URL and parsed route (organization, binder, document, branch,
  version, change), app version and commit, browser and viewport, the last API
  calls (method, path, status, duration, the API's `X-Request-Id`), recent
  console errors and uncaught exceptions, route breadcrumbs, and which queries
  are failing. **Never** request or response bodies, document text or
  screenshots: all three can hold patient information, and the route already
  says exactly which document and version the person was looking at.
- **Abuse.** Turnstile, a per-IP limit from the Workers Rate Limiting binding
  (the free plan's one WAF rate-limit rule already guards sign-in), and hard
  size caps.

## Error Reports

`production-architecture.md` §5 asks for an error tracker for the API and the
SPA. Sentry would be a new subprocessor and a third-party SDK in an app whose
privacy policy says it runs none. The feedback Worker already has everything
an error tracker needs at this size: a GitHub App, a rate limiter, and a
private repository on the other end. So errors take the same road, on a second
route.

```
SPA  window "error" / "unhandledrejection"     feedback.bindersnap.com/errors
 errorReporter: scrub, dedupe, ≤ 10 a page ─►  1. SPA: the app's origins only
API  logger.error ─────────────────────────►     API: Bearer ERROR_REPORT_SECRET
 errorReporter: scrub, dedupe, ≤ 1 a minute    2. per-IP limit, size, shape
                                                3. scrub again, fingerprint
                                                4. per-fingerprint limit: 1 a minute
                                                5. find the fingerprint's issue:
                                                   none → open one
                                                   open → comment
                                                   closed as done → reopen, "regression"
                                                   closed as not planned → muted
```

- **Its own private repository**, `bindersnap-errors`, filed by the same
  GitHub App. Automatic reports stay out of the human feedback queue.
- **What it carries: what broke, never for whom.** The error's type, its
  message and stack with emails, tokens, long numbers and quoted phrases cut
  out, the app's version, which kind of page (`binderDocument`, never the
  organization, binder or document), the browser, and the API's request ID.
  No user, no organization, no URL. The request ID finds everything else in
  CloudWatch, which is where the rest of the detail already lives.
- **Grouping without state (rule 1).** The Worker names each error by a
  fingerprint: its source, its type and its message with every number and ID
  taken out. The fingerprint goes in the issue's title, and GitHub's search
  finds it again. A Rate Limiting binding keyed on the fingerprint lets one
  write through a minute, so a burst becomes one comment, and the lag in
  GitHub's search index cannot open the same issue twice.
- **Muting is closing.** Close an issue as _not planned_ and its error stops
  writing to it. Close it as _completed_ and the next occurrence reopens it as
  a regression.
- **No Turnstile.** An error cannot stop to solve a challenge. The SPA route
  is open to anyone who sends the right `Origin`, so the worst abuse is fake
  issues in a private repository: noise, not a leak. The per-IP,
  per-fingerprint and overall limits bound it. If it happens, the answer is
  the BFF-signed ticket feedback would use too.
- **The API sends its own** with a shared secret, `ERROR_REPORT_SECRET`. It is
  not a Gitea or session credential, and the Worker still never calls the
  API (rule 4). It is off the critical path: a report that fails is a warning
  in the log, never an error, so it cannot report itself.

## Consequences

- **Two kinds of deploy.** The host by pyinfra, the Workers by `wrangler`.
  Both run from GitHub Actions on push to `main`.
- **GitHub becomes a subprocessor for feedback.** People can type personal
  data into the form. The subprocessor list and privacy policy say so.
- **GitHub also receives error reports, without anyone pressing a button.**
  They carry no user or organization, but an error message is not something a
  person chose to send, so the privacy policy names them as their own row.
- **Free-plan limits apply.** 100,000 requests a day and 10 ms of CPU per
  request; the feedback Worker spends its time waiting on GitHub, which does
  not count against CPU.

## Alternatives Considered

- **A BFF endpoint.** Fails when the host is down, which is exactly when a
  report matters most. It would also put a GitHub credential on the host for
  something that has nothing to do with documents.
- **[BugDrop](https://github.com/mean-weasel/bugdrop)** (MIT, a Worker plus a
  GitHub App). The same shape, but generic. It commits screenshots to a branch
  of the target repository, where anything they show lives in git history for
  good. It cannot see the session, the route or the API's request IDs, and
  those are most of a report's value.
- **Sentry User Feedback.** Good at what it does, but turning feedback into a
  GitHub issue needs a paid plan, and it adds a subprocessor for this alone.
- **Sentry as the error tracker.** Better grouping, source maps and a UI built
  for it. It costs a new subprocessor, a third-party SDK in the app, and a
  change to the privacy policy's promise of none. At this size, an issue per
  error in a private repository is enough, and nothing about it stops a move
  to Sentry later.
