# `tests/` — Integration Test Stack

Everything needed to run the **full Bindersnap target architecture locally** for development and integration testing.

## What this spins up

| Service        | URL                                        | Purpose                                              |
| -------------- | ------------------------------------------ | ---------------------------------------------------- |
| Gitea          | `http://localhost:${GITEA_PORT:-3000}`     | Git backend, auth source, document storage           |
| Hocuspocus     | `ws://localhost:${HOCUSPOCUS_PORT:-1234}`  | Real-time collaboration WebSocket server             |
| Caddy          | `http://localhost:${API_PROXY_PORT:-8788}` | Local reverse proxy for production-style API ingress |
| API            | `http://localhost:${API_PORT:-8787}`       | The BFF (`services/api/`)                            |
| Bindersnap app | `http://localhost:${APP_PORT:-5173}`       | The unified SPA (`apps/app/`) with hot reload        |

## Running integration tests

```bash
bun run test:integration
```

No shell scripts. No manual `bun run up` beforehand. Playwright's
`globalSetup` starts the full Docker Compose stack, including the local Caddy
proxy in front of the API, waits until the stack is reachable, then runs all
`*.pw.ts` test files. `globalTeardown` shuts the stack down when the run
finishes, whether it passed or failed.

First run takes ~60s for Gitea to initialize and images to pull. Subsequent runs are
faster because Docker caches the images.

### Using an already-running stack

If you have the stack running from `bun run up` and want to skip the start/stop cycle:

```bash
SKIP_STACK=1 bun run test:integration
```

`SKIP_STACK=1` tells `globalSetup` and `globalTeardown` to leave the stack alone.
If you want proxy-path webhook coverage in that mode, make sure the existing
stack includes the local Caddy service on `http://localhost:${API_PROXY_PORT:-8788}`.

### Workers, and when a spec file may be serial

CI runs four Playwright workers, and a local run uses half the cores. Set
`PLAYWRIGHT_WORKERS` (a count like `3`, or a percentage like `50%`) to override
either one.

A spec file whose tests each sign up their own account and build their own
organization is `mode: "parallel"`, so its tests can spread across workers.
Mark a file `serial` only if its tests really share something: a `beforeAll`,
a module-level variable one test sets and a later one reads, or seeded data
that one test changes and another asserts on. A serial file ties up one worker
from its first test to its last. Before these files went parallel,
`workspace-provisioning` alone ran six minutes that way.

### Testing an API you built from source

By default the run goes through the stack's Caddy proxy, which means the API
under test is the one baked into the container image — an API change is only
exercisable after a rebuild, and CI becomes the only loop. Set
`BUN_PUBLIC_API_BASE_URL` and the test workers call your API instead:

```bash
bun run up                                   # terminal 1: the stack
PORT=8790 bun run dev:api                    # terminal 2: your API, from source
SKIP_STACK=1 BUN_PUBLIC_API_BASE_URL=http://localhost:8790 bun run test:integration
```

The value has to come from the environment, not from `.env` — `.env` supplies
defaults, and only what you type is treated as an override. `globalSetup` waits
for `/auth/me` on that URL and fails with one clear message if nothing answers,
rather than letting every suite fail on its own.

What this does and does not cover: every suite that talks to the API over
`fetch` exercises your build, which is most of the API-level coverage. The app
container's SPA has its own base URL baked in at image build and still calls
the proxy, so browser-driven assertions stay about the containerised API. Your
API needs `BINDERSNAP_ALLOWED_ORIGINS` to include the app origin, and needs to
point at the same Gitea the stack is running.

### Which ports am I on?

You do not choose. The first `bun run up`, `bun run down`, `bun run stack
status` or `bun run test:integration` in a checkout claims a free block of five
ports for it, writes them into that checkout's `.env` under a managed block,
and records the claim in `~/.bindersnap/stacks.json`. The claim is sticky, so
the ports survive restarts, and the allocation is taken under a lock, so
several worktrees starting at the same moment cannot claim the same block.

The main checkout keeps the historical ports (5173, 8787, 8788, 3000, 1234).
Every other worktree gets a block from 21010 upwards. Ask for yours:

```bash
bun run stack status          # human-readable, including the seed password
bun run stack status --json   # { stackName, slot, ports, urls, running }
bun run stack status --all    # every stack registered on this machine
```

Because the compose project name is derived from the same claim, `bun run down`
can only ever remove the containers, network and volumes belonging to the
worktree you ran it in.

If a worktree is deleted while its stack is up, `bun run stack prune` tears the
orphan down and frees its ports. Run `bun run down` before deleting a worktree
and you will not need it — a running stack holds files under `data/`, which is
what makes `git worktree remove` fail.

### Overriding ports

The values are still plain environment variables, so a one-off override works —
but the managed `.env` block is the supported path, and a hand-edited port that
another stack already owns will simply fail to bind:

| Variable          | Default | What it moves                       |
| ----------------- | ------- | ----------------------------------- |
| `APP_PORT`        | `5173`  | The SPA                             |
| `API_PORT`        | `8787`  | The BFF                             |
| `API_PROXY_PORT`  | `8788`  | The Caddy proxy in front of the BFF |
| `GITEA_PORT`      | `3000`  | Gitea                               |
| `HOCUSPOCUS_PORT` | `1234`  | The collaboration websocket server  |

```bash
APP_PORT=4000 bun run test:integration
```

### Running several stacks side by side (one per worktree)

Nothing to set up: this is what the automatic allocation above buys. Ports are
only half the problem — container names, the network name and the volume prefix
all have to differ too, and `STACK_NAME` moves all of them at once. It is the
Compose project name, so it prefixes every container, the network
`${STACK_NAME}-dev`, and every volume, and it is derived from the worktree's
directory name and slot.

So in each worktree, `bun run up`, `bun run down` and `bun run test:integration`
operate on that worktree's stack alone. Gitea's data lives in the worktree's own
`./data/gitea`, so the instances never share state.

Verified with six worktrees allocating at once and four full stacks running
side by side; see `scripts/stack.test.ts`.

## Stripe billing flow

The local compose stack can exercise the subscription checkout flow when the
API container gets real Stripe test credentials from `.env`.

Set these values before `bun run up`:

- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_PRICE_ID=price_...` for the subscription price you want to test

`bun run test:integration` will start `stripe listen` automatically, capture the
runtime webhook signing secret, inject it into the API container, and keep the
listener alive for the duration of the Playwright run.

Set `STRIPE_WEBHOOK_SECRET` yourself only when you are testing the billing flow
manually outside Playwright, for example with `bun run up`.

The `tests/stripe-subscription.pw.ts` suite reads the same Stripe values and
skips Stripe-specific assertions when they are unset.

When Stripe credentials are absent, the test runtime injects a deterministic
`STRIPE_WEBHOOK_SECRET` into the local stack so the signature-verification and
`/stripe/webhook`-through-Caddy coverage still runs. The dedicated proxy test
is `tests/stripe-webhook-caddy.pw.ts`.

### Stripe billing in CI

The Playwright integration job in `.github/workflows/pr-verify.yml` enables
Stripe billing coverage only when these GitHub Actions secrets are set:

- `STRIPE_TEST_SECRET_KEY`
- `STRIPE_TEST_PRICE_ID`

When both are present, the workflow installs the Stripe CLI, `globalSetup`
starts `stripe listen`, and the runtime webhook signing secret is generated on
the fly. Do not store `STRIPE_WEBHOOK_SECRET` in CI — the test runtime creates
it for each run before `docker compose up`.

## Running unit tests

Unit tests live alongside source as `*.test.ts` and use `bun:test`. No Docker required.

```bash
bun test apps/app packages/editor packages/utils
bun test services/api scripts infra/backups
```

## Seeded data

After Gitea is healthy, the `seed` container runs `tests/seed.ts`, which applies
the scenario described in **[`tests/seed-data/dev.yaml`](seed-data/dev.yaml)**.

**That YAML file is the seed data.** Want another account, another binder, or a
policy parked in a particular review state? Edit the YAML. `seed.ts` is only the
engine that turns the description into Gitea calls — you should not need to read
it.

The premise is that **you should not have to build a state by hand to look at
it**. Everything below is already in the stack the moment `bun run up` finishes.
The YAML's own header carries the same index, next to the data.

### The people

Every seeded account signs in with the password `dev`.

| User    | Who they are                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `alice` | Runs Bindersnap itself — the only **site administrator** — and owns Riverside Health                                                     |
| `priya` | Quality director. An **organization owner who is not a site admin**, which is who most of the billing and people screens are written for |
| `bob`   | Legal counsel. Publishes in three binders and signs off on contracts                                                                     |
| `carol` | Operations lead. The other administrator of the HR binder                                                                                |
| `dan`   | External auditor. Reviews everywhere and **can publish nothing**                                                                         |
| `grace` | Infection control lead                                                                                                                   |
| `hugo`  | Pharmacy director. Reviewer only                                                                                                         |
| `ines`  | Ward manager                                                                                                                             |
| `omar`  | Facilities manager — the only author in that binder                                                                                      |
| `erin`  | In the organization and **in no binder's teams**. Sees only what the organization is open to                                             |
| `frank` | Signed up and belongs to **no organization at all**                                                                                      |

### The binders

Seven, each there for a shape the others do not have. All are owned by the
`riverside-health` organization — ADR 0004's first level.

| Binder              | What it is there for                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `clinical`          | The everyday binder: every depth of folder, every file type, one of each review state, and **no sign-off rules** |
| `corporate`         | The awkward change requests — out of date, crowded with reviewers, heavy with discussion, one that archives      |
| `governance`        | **Covered in sign-off rules** (all four scopes) and the only binder asking for **two approvals**                 |
| `facilities`        | An admin team and authors and **no reviewers**                                                                   |
| `safety`            | Admins, authors and reviewers, and **open to the whole organization**                                            |
| `hr-investigations` | **An admin team and nobody else.** Why "open to everyone" is a switch and not a law                              |
| `retired-policies`  | **Nothing in it.** What every new customer sees first                                                            |

"Public" and "private" here are the product's, not Gitea's: a binder is open to
the organization when the org's `staff` team is granted read on it. Sign in as
`erin` to see the difference — she is in no binder's teams, so `safety` is the
only one she can open.

### The filing

| What                            | Where                                                    |
| ------------------------------- | -------------------------------------------------------- |
| A document at a binder's root   | `clinical/code-of-conduct`                               |
| One folder deep                 | `clinical/nursing/…`                                     |
| Two folders deep                | `clinical/nursing/wards/handover-standard`               |
| A folder with nothing in it     | `clinical/nursing/wards/ward-7` — a committed `.gitkeep` |
| A document nobody has published | `clinical/administrative/records-retention` (Draft)      |

### The change requests

| What                                          | Where                                         |
| --------------------------------------------- | --------------------------------------------- |
| Out of date by three of its own versions      | `corporate/security/access-control-standard`  |
| Out of date behind other people's work        | `corporate/finance/purchasing-policy`         |
| Six reviewers asked, one has answered         | `corporate/security/business-continuity-plan` |
| Many discussions, every one closed            | `corporate/finance/expenses-policy`           |
| Discussions still open                        | `corporate/finance/travel-policy`             |
| Moves, renames and rewrites in one change     | `clinical`, the open shape change             |
| Makes empty folders                           | `clinical`, the published shape change        |
| Renames a folder, moving every file under it  | `facilities`, `plant` became `estates`        |
| Takes a document off the record               | `corporate`, the published archive            |
| Changes who signs things off                  | `governance`, the open sign-off change        |
| Closed with work still asked for — _Declined_ | `clinical/nursing/infection-control-policy`   |
| Closed with nobody having asked — _Withdrawn_ | `clinical/code-of-conduct`                    |

Plus every review state the list can show — Draft, In review, Changes
requested, Ready to publish, Published — and a document (`clinical`'s HIPAA
training policy) that has been through **five** published versions.

`closed: true` on a change closes it without publishing. How it _reads_ is not
declared: a closed change with somebody's request for work standing against it
is **Declined** and one without is **Withdrawn**, which the product works out
from the reviews. Say what happened and the label follows.

### The file types

The same house structure in each of the four formats, so the preview and
comparison screens can be judged on the file type rather than on the prose.

| Format        | An example                                          |
| ------------- | --------------------------------------------------- |
| `prosemirror` | Most of them — the editor's own JSON                |
| `markdown`    | `clinical/administrative/patient-grievance-policy`  |
| `docx`        | `clinical/nursing/infection-control-policy`         |
| `pdf`         | `clinical/nursing/medication-administration-policy` |

Set a document's `format:` in the YAML (`prosemirror`, `markdown`, `pdf`, or
`docx`) and the prose beneath it is rendered into that file. Word files and PDFs
are generated from the same YAML rather than committed as binary fixtures, so
editing a policy is still a YAML edit. Their timestamps are pinned — otherwise
identical prose would produce different bytes on every run and each re-seed
would silently add another update to every open change.

Plus review threads (open and resolved), the customer's own reusable groups,
protected `main` branches, `<uid>/vN` version tags carrying the approval policy
in force at each publish, and a public OAuth2 app registered for PKCE login at
the app's redirect URI.

### Writing a scenario

A binder's `documents` carry the changes that are about one policy. A binder's
own `changes` carry the ones that are not — a folder made, a policy refiled,
the sign-off rules rewritten — each as a list of **acts**:

```yaml
changes:
  - branch: shape/alice/20260310090000
    title: Make room for ward 7
    summary: A folder, empty until the policies for it are written.
    publish: true
    acts:
      - newFolder: nursing/wards/ward-7
    reviews:
      - by: carol
        state: approved
        body: Ward 7 opens in April. Approved.
```

The acts are `newFolder`, `renameFolder`, `move`, `revise`, `archive` and
`signOff`. Binder changes are applied after every document's own, so a rename
has something to rename.

The parser refuses a scenario that would seed successfully and leave the stack
quietly wrong — an approval from somebody whose approval Gitea would not count,
a change approved by its own author, a sign-off rule naming a group the binder
has not granted, a branch prefix that would make the binder list a policy that
does not exist. Each of those otherwise costs ten seconds of merge retries and
an error in Gitea's words rather than a line number in the YAML.

Integration tests call `seedDevStack()` from `seed.ts` themselves to ensure these
fixtures are present before asserting against them. Seeding is idempotent —
re-running it against an already-seeded Gitea is safe, including after a password
change, and it _reconciles_: somebody moved from one team to another in the YAML
is removed from the old one. The single exception is a change made of acts. Its
commit is a list of moves against a particular tree, so the branch is written
once and then left alone — exactly as a real change request's commit is.

Validate the scenario without starting anything:

```bash
bun run test:seed
```

## Re-seeding from scratch

```bash
bun run down             # destroys volumes
bun run test:integration # starts fresh and re-seeds
```

## Structure

```
tests/
  README.md                 — this file
  playwright.config.ts      — Playwright configuration
  global-setup.ts           — starts the Docker Compose stack before tests
  global-teardown.ts        — tears down the stack after tests
  seed-data/dev.yaml        — THE SEED DATA: users, documents, changes, reviews
  seed-scenario.ts          — the seed format: types, validation, document rendering
  seed-scenario.test.ts     — unit tests for the format and for dev.yaml itself
  seed-documents.ts         — a document's prose to bytes: Markdown, PDF, .docx
  seed-documents.test.ts    — unit tests for each format, and for reproducibility
  seed.ts                   — the engine that applies a scenario to Gitea
  helpers.ts                — shared constants, createMemoryStorage, makeClient,
                              pollUntil, resolveAndStoreToken — imported by all *.pw.ts
  smoke.pw.ts               — stack health checks + app shell route smoke tests
  pkce-oauth.pw.ts          — PKCE OAuth2 app registration and SPA route tests
  gitea-services.pw.ts      — gitea-client integration tests (auth, documents,
                              pull requests, repos, uploads)
```

### Why there is no api-auth.pw.ts

The product app now authenticates through `services/api` with an `HttpOnly`
session cookie, but the end-to-end auth path is already exercised through the
main Playwright flows. A separate browser-only auth suite would duplicate the
same surface without adding much signal.

## This is not production

`tests/` is a developer tool. It is never deployed. The Docker Compose config uses
insecure defaults (fixed passwords, no TLS) that are intentional for local speed.
Do not use this config as a basis for any production deployment.
