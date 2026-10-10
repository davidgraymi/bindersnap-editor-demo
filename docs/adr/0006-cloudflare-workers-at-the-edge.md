# ADR 0006: Cloudflare Workers at the Edge

Status: Accepted
Date: 2026-10-09
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
anyway: `bindersnap.com` is an assets-only Worker (`wrangler.jsonc`,
`static-site.yml`). That document squared it with the rule by reading "no
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

### Workers today

| Worker                | Code of ours | What it does                                                       |
| --------------------- | ------------ | ------------------------------------------------------------------ |
| `bindersnap-site`     | none         | Serves `dist/` (site + SPA) on `bindersnap.com`                    |
| `bindersnap-feedback` | yes          | Turns a feedback report into an issue in the private feedback repo |

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

## Consequences

- **Two kinds of deploy.** The host by pyinfra, the Workers by `wrangler`.
  Both run from GitHub Actions on push to `main`.
- **GitHub becomes a subprocessor for feedback.** People can type personal
  data into the form. The subprocessor list and privacy policy say so.
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
  GitHub issue needs a paid plan, and it adds a subprocessor for this alone. It
  is still the likely error tracker (`production-architecture.md` §5). If it
  arrives, its event ID can join the trace.
