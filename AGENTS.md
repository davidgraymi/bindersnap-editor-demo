# AGENTS.md — Bindersnap Codebase Guide

This file is for AI agents, LLMs, and automated tools working in this codebase.
It describes what Bindersnap is, how the product is designed, and the rules you
must follow when generating or modifying any code, copy, or assets.

It is the one instruction file. `CLAUDE.md` holds only `@AGENTS.md`, so Claude
Code reads this file even where it would not load `AGENTS.md` on its own. Put
new instructions here, never in `CLAUDE.md`.

---

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Run the app (Gitea + seed + Hocuspocus + API + Caddy + app)
bun run up            # Start this worktree's stack; waits until ready, then exits
bun run down          # Tear down this worktree's stack, and only this one
bun run stack status  # Your ports, your URLs, your login — add --json to parse

# Partial servers — neither gives you a working app on its own
bun run dev:app       # The app shell on APP_PORT and the public site (landing,
                      # marketing, help, legal) on SITE_PORT. Calls no API.
bun run dev:api       # API only: still needs Gitea, which only `bun run up` runs.

# Build
bun run build         # Build SPA to dist/

# Tests
bun run test          # All unit tests (test:app + test:ops + test:seed)
bun run test:app      # apps/app, apps/help, apps/legal, apps/site, packages/editor, packages/utils, packages/ui-tokens
bun run test:ops      # services/api, services/feedback, scripts, infra/backups
bun run test:integration  # Playwright — starts and stops its own stack
                          # SKIP_STACK=1 reuses a running `bun run up` stack
                          # Both find this worktree's ports on their own
bun test path/to/file.test.ts  # Single file

# Code formatting
bun run format        # Format all source files
bun run format:check  # Check without writing
```

Test files live alongside source as `*.test.ts`. TypeScript strict mode is the linter.

Production deploys run themselves — `deploy-pyinfra.yml` on every push to `main`.
To drive one by hand (Python, not Bun):

```bash
python3 -m venv deploy/.venv
deploy/.venv/bin/pip install -r deploy/requirements.txt
source deploy/.venv/bin/activate

deploy/bin/ssm-connect.sh --dry   # report changes without applying
deploy/bin/ssm-connect.sh         # apply
```

## The stack, if you are an agent in a worktree

**Everything you need is `bun run up`, `bun run down`, and `bun run stack status`.**
Run them from your own worktree and you cannot collide with, or tear down,
another session's stack. Four rules:

1. **Never run `docker compose` directly, and never edit the ports in `.env`.**
   `docker-compose.yml` derives its project name and every published port from
   `STACK_NAME` and the `*_PORT` variables, which fall back to one shared
   default. A raw `docker compose down` from a worktree kills whatever is
   running on the defaults — in practice the developer's own stack.
2. **Never assume port 5173.** Your worktree gets its own port block, claimed
   automatically on first use and recorded in `.env`. Ask for it:
   `bun run stack status` (or `--json` for `ports`, `urls`, `stackName`,
   `running`).
3. **`bun run up` exits when the stack is ready** — it is safe to await. It
   builds, starts detached, waits for Gitea, the API, the proxy and the app to
   answer, then prints your URLs. Use `bun run up:fg`
   only if a human wants the log stream; it never returns.
4. **`bun run down` before you delete a worktree.** A running stack holds files
   in `data/`, which is what makes `git worktree remove` fail. If a worktree is
   already gone, `bun run stack prune` tears down its orphaned stack and frees
   its ports.

Other commands: `bun run stack logs [service]`, `bun run up --fresh` (wipe
volumes and seeded Gitea data first), `bun run stack status --all` (every stack
on this machine).

## Validating a change in the browser

`bun run up` is the only way to see the real app. Its `app` container bind-mounts
the repo and runs `bun --hot server.ts` — it **is** the dev server. Edits under
`apps/` and `packages/` hot-reload with nothing to restart, at the app URL that
`bun run stack status` prints. The `api` container runs the bind-mounted
`services/api/server.ts` under `bun --watch`, so a server edit restarts the API
on its own. Sign in as `alice`, `bob`, `carol`, or `dan` with the password
`dev` — on every stack, always.

**Do not start a second SPA on another port to preview a change.** The API sends
CORS headers for exactly one origin — your stack's own `APP_PORT`, set as
`BINDERSNAP_APP_ORIGIN` in `docker-compose.yml` — and compose does not pass
`BINDERSNAP_ALLOWED_ORIGINS` through, so there is no override. A `bun run dev:app`
on any other port gets every API call blocked by CORS and can never sign in. It
renders the sign-in page and nothing behind auth.

The app and the public site are two origins, as in production
(`app.bindersnap.com` and `bindersnap.com`): the app on `APP_PORT`, the landing
page, marketing, help and legal on `SITE_PORT`. `bun run stack status` prints
both.

A dependency change is the one thing hot reload cannot pick up: the container
bakes its own `node_modules` into a volume at image build, so a package added on
the host stays invisible until the stack is rebuilt. Fix that with a full
`bun run down && bun run up` — never by killing a process or rebuilding a single
container, which leaves the stack in a half-state.

---

## Repo Architecture — Read This First

This is a monorepo containing **one frontend application**, **shared packages**,
**backend services**, and **infrastructure code**. Understanding which directory
serves which purpose is essential before making any changes.

```
bindersnap-editor-demo/
│
├── apps/
│   ├── app/                        ← THE APP, app.bindersnap.com (static files on Cloudflare)
│   │   ├── index.html              ← React mount root
│   │   ├── App.tsx                 ← Auth gate + routing
│   │   ├── api.ts                  ← All browser-to-API calls (BFF client)
│   │   ├── routes.ts               ← Client-side route definitions
│   │   └── components/             ← App shell, binder and document UI
│   ├── site/                       ← THE PUBLIC SITE, bindersnap.com: landing + marketing
│   ├── help/                       ← bindersnap.com/help
│   └── legal/                      ← bindersnap.com/legal
│
├── deploy/                         ← CONFIGURATION AS CODE (pyinfra push deploy)
│   ├── deploy.py                   ← The production deployment itself
│   ├── inventory.py                ← Single prod host + SSH-over-SSM connection
│   ├── files/                      ← Runtime config uploaded to the host
│   ├── bin/ssm-connect.sh          ← Ephemeral key + SSM tunnel, then pyinfra
│   └── README.md                   ← Read before touching production config
│
├── infra/                          ← INFRASTRUCTURE AS CODE (Terraform only)
│   ├── compute/                    ← EC2 Terraform for the app host
│   ├── edge/                       ← Cloudflare: DNS, tunnel, email routing
│   ├── email/                      ← SES
│   ├── billing/, billing-test/     ← Stripe catalog (live, and CI's test mode)
│   ├── account-baseline/           ← CloudTrail, GuardDuty, budgets
│   ├── backups/                    ← DLM snapshot policy
│   ├── ci/                         ← GitHub Actions OIDC role
│   ├── secrets/                    ← AWS Secrets Manager
│   ├── state/                      ← Terraform remote state
│   └── monitoring/                 ← CloudWatch / alerting
│
├── packages/                       ← Shared internal libraries
│   ├── editor/                     ← Tiptap editor component, imported by the app
│   │   └── README.md               ← Read before editing
│   ├── api-schema/                 ← Zod schemas → openapi.json for the BFF
│   ├── api-client/                 ← Typed client generated from that schema
│   ├── ui-tokens/                  ← CSS design tokens, fonts, icons
│   └── utils/                      ← Shared utilities (sanitizer, document UIDs, CODEOWNERS)
│
├── services/                       ← Deployable backend services
│   ├── api/                        ← Auth + data BFF (Bun, port 8787)
│   │   ├── server.ts               ← HTTP server entry point
│   │   ├── sessions.ts             ← SQLite session store
│   │   └── README.md               ← API env vars and routes
│   ├── hocuspocus/                 ← Yjs WebSocket collaboration server
│   │   ├── server.ts               ← Hocuspocus server entry
│   │   └── Dockerfile
│   └── feedback/                   ← Cloudflare Worker: in-app feedback → GitHub issue (ADR 0006)
│       └── README.md               ← Read before editing
│
├── tests/                          ← Integration tests (Playwright)
│   └── data/                       ← Seed files for local stack
│
├── scripts/                        ← Build and utility scripts
│   └── bootstrap-gitea-service-account.ts  ← Provisions the service account token
│
├── server.ts                       ← Bun dev server: the app on APP_PORT, the site on SITE_PORT
├── docs/                           ← Brand assets and ADRs
├── .github/workflows/              ← CI/CD pipelines (static-site.yml, deploy-pyinfra.yml)
├── .claude/                        ← Claude agent definitions
├── AGENTS.md                       ← This file
├── CLAUDE.md                       ← `@AGENTS.md`, nothing else
├── docker-compose.yml              ← Local dev stack (Gitea + Hocuspocus + app)
└── Dockerfile                      ← Dev-only Dockerfile for the app container
```

### The app

`apps/app/` is the app at `app.bindersnap.com`, a React SPA. It holds no
landing page: that is `apps/site/`, on `bindersnap.com` (see "The public site").

Routes:

- `/` — the signed-in person's home; signed out, it sends you to `/-/login`
- **The app's own pages are behind `/-/`**, the way GitLab keeps
  `/-/user_settings/profile` apart from `/{group}`. No organization can be
  called `-`, so none of them can shadow one, and an organization may be named
  almost anything. Add new app-wide pages here, never as a bare first segment.
  - `/-/login`, `/-/signup` — credential forms
  - `/-/documents` — the library; `/-/changes` — every change in flight
  - `/-/organizations/new` — create (or ask to join) an organization
  - `/-/user_settings/profile` — the signed-in person's own account
  - `/-/billing` — the session's organization's billing, rewritten to
    `/{org}/-/billing`; `/-/admin/subscriptions` — site admins only
- `/{org}` — an organization; `/{org}/-/people`, `/{org}/-/billing`,
  `/{org}/-/settings`, `/{org}/-/binders/new`
- `/{org}/{binder}` — a binder; its screens and documents are behind its own
  `/-/` (`/-/changes/3`, `/-/blob/main/{path}`, `/-/settings`)
- Reserved first segments (`RESERVED_ORGANIZATION_NAMES` in
  `packages/utils/organizationName.ts`) are only what cannot move off the
  root: `-`, `auth` (`/auth/callback`, where Gitea's sign-in returns), and the
  files in `apps/app/public` (icons, fonts, `robots.txt`). Help, legal and the
  marketing sections are on `bindersnap.com`, another origin, and take no names.

### The public site

`apps/site/` is `bindersnap.com`: the landing page and the marketing pages,
Markdown in `apps/site/content/`. Its own guide, `apps/site/AGENTS.md`, loads
when you work there. Marketing copy may say "policy"; the app says "document".

### The editor, the comparison and the conflict resolver

Each is described in full in `apps/app/AGENTS.md`, which loads when you work in
`apps/app/`. What applies outside that directory:

- **`packages/editor/documentSchema.ts` is the one list of Tiptap extensions**
  the editor and the reader (`apps/app/editorDocumentHtml.ts`) both load. Add a
  node or an attribute there, never to one side: ProseMirror drops what its
  schema does not declare, so formatting added only to the editor vanishes for
  every reviewer. The sanitizer keeps a filtered set of inline styles
  (`safeStyle` in `packages/utils/sanitizer.ts`) for the same reason.
- **Pictures are embedded, not linked** (`packages/editor/imageFiles.ts`): a
  scaled `data:` source in the document, versioned with the words. The
  sanitizer (`isSafeImageSrc`) refuses SVG and every other `data:` address.
- **Saving in the editor commits to the author's draft**, never to `main`; the
  version on record moves only when the draft is proposed and published.
- **Every file read by the comparison goes by identity, never by address**
  (ADR 0005): a renamed policy has two addresses and the base ref knows only one.
- **Conflicts are resolved on the change's branch in three commits**
  (`services/api/gitea-client/conflicts.ts`), because Gitea cannot write a
  merge commit with chosen contents. Files are paired by identity.

### The BFF (`services/api`)

All browser-to-data calls go through the BFF. The browser never contacts Gitea
directly.

The router is the `pathname` chain at the bottom of `services/api/server.ts`;
`packages/api-schema` describes the same routes as Zod schemas and generates
`openapi.json`, which `packages/api-client` is typed from. The families:

- `/auth/*` — signup (creates the Gitea account, then the organization and its
  first binder, ADR 0004), login, logout, `me`, email verification, password reset
- `/api/app/binders/:org/:binder/...` — a binder: its documents, folders,
  renames, archives and restores, drafts, changes (reviews, discussions,
  reactions, assignments, conflicts, update, publish), people, groups, rules,
  settings, history, raw files, audit and export
- `/api/app/orgs/:org/...` — an organization: its binders, people, groups,
  invitations, deletion
- `/api/app/documents` and `/api/app/home/changes` (across every binder),
  `/api/app/organizations`, `/api/app/invitations/*`, `/api/app/account/*`,
  `/api/app/billing/*`, `/api/app/notifications*`, `/api/app/legal*`,
  `/api/app/users/search`, `/api/app/onboarding`, `/api/app/admin/*`
- `/stripe/webhook`, `/email/unsubscribe`, `/healthz`

A binder change's detail carries `documents` (what publishing would version)
**and** `removedDocuments` (what it takes off the record) — separate lists,
because a tag on a file that is no longer in the merged tree is the bug the
publish guard exists to prevent. A rename is in neither: Gitea reports one as
a delete plus an add, and the server subtracts the UIDs that came back.

Per-session Gitea tokens are stored server-side in a SQLite session store
(`services/api/sessions.ts`). The browser holds only the `bindersnap_session`
`HttpOnly` cookie, and no response ever carries a Gitea token — not `/auth/me`,
not login (#662).

### The integration testing stack

`docker-compose.yml` runs the whole stack locally — Gitea, the seed job,
Hocuspocus, the API, Caddy and the app. Start it with `bun run up` (and stop it
with `bun run down`; those two scripts are the only supported lifecycle, and
they are safe to run concurrently from several worktrees — each claims its own
project name and port block, so neither can touch another's containers. Ask
`bun run stack status` which ports are yours; never assume the defaults). It
seeds eleven accounts and seven binders automatically from
`tests/seed-data/dev.yaml`. That file is deliberately full of edge cases — a
binder with nothing in it and one covered in sign-off rules, a change six people
have been asked to review and one nobody has looked at in three versions, empty
folders, every file type the comparison screen can meet — so that looking at a
state does not mean building it first. Its header indexes what is in there and
`tests/README.md` says the same in prose. Use this to:

- Verify Gitea service implementations against a real API
- Run integration tests (`bun run test:integration`)
- See how the real app looks with realistic data — the app container is the
  hot-reloading dev server, so edits show up at the app URL `bun run stack
status` prints, without a restart. See "Validating a change in the browser"
  above.

See `tests/README.md` for full usage.

### Deployment

Everything except the SPA and the feedback Worker runs as Docker Compose
services on **one EC2 host**, deployed by **pushing with pyinfra** from GitHub
Actions. There is no serverless backend: Lambda, Aurora, API Gateway and the
Gitea-as-NAT plumbing were removed (epic #302). See
`docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md`, and
`docs/adr/0006-cloudflare-workers-at-the-edge.md` for the Workers.

| Component  | Host           | How deployed                                                          |
| ---------- | -------------- | --------------------------------------------------------------------- |
| App (SPA)  | Cloudflare     | `static-site.yml` (`wrangler deploy`) on push to `main`               |
| Site       | Cloudflare     | same workflow; `bindersnap.com`, landing/marketing/help/legal         |
| API        | EC2 via Docker | `deploy-pyinfra.yml` (pyinfra over SSH-through-SSM) on push to `main` |
| Gitea      | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |
| Hocuspocus | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |
| Caddy      | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |
| Feedback   | Cloudflare     | `feedback-worker.yml` (`wrangler deploy`) on push to `main`           |

The SPA is built with `BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com`
baked in at compile time, and served from `app.bindersnap.com`; the public
site is `bindersnap.com`. Locally, the API is `http://localhost:8787`, and the
app and the site are `APP_PORT` and `SITE_PORT`.

**Terraform provisions; pyinfra configures.** These do not overlap:

- Anything about the _host's contents_ — packages, config files, secrets,
  containers, the CloudWatch agent — belongs in `deploy/`. Adding a config file
  is a commit to `deploy/files/`, not an infrastructure change.
- Anything about _AWS resources_ — instance, volumes, IAM, networking, backups,
  monitoring, Parameter Store — belongs in `infra/`.
- `infra/compute/user-data.sh` does exactly one thing: confirm the SSM agent is
  running. Do not add bootstrap logic to it, and do not reintroduce a config
  bucket. If you find yourself editing Terraform to change how the app is
  configured, you are in the wrong directory.

How a deploy runs, rollback and the production security rules are in
`deploy/AGENTS.md`, which loads when you work in `deploy/`. Read
`deploy/README.md` before changing anything there, and `docs/ops/deploy.md` for
the pipeline, required GitHub variables, and rollback.
`docs/ops/break-glass.md` covers recovering the host over SSM when CI is
unavailable.

---

## Architecture Decisions — Read Before Writing Any Code

These are settled, non-negotiable decisions. Do not reopen them. Do not work
around them. If a task seems to require violating one of these, stop and create
a `human-needed` issue instead.

In short — each is explained below:

1. **The BFF owns auth; Gitea tokens stay server-side.** The browser holds only
   an `HttpOnly` session cookie.
2. **Evidence lives in Gitea; configuration lives in SQLite.** Documents,
   versions, approvals, reviews, comments and tags are git objects, never
   SQLite rows. See ADR 0004.
3. **File uploads flow browser → BFF → Gitea.** ADR 0001 is law, except its
   "one document = one repository", superseded by ADR 0004.
4. **Two independent workflows.** The file vault (external uploads) and the
   inline editor are separate. Do not conflate them.
5. **Editor UI changes need a flag.** If you change `packages/editor/` visuals,
   note it in your PR.
6. **`deploy/` configures the host; Terraform does not.** No serverless backend,
   no config bucket, no bootstrap logic in `user-data.sh`. Cloudflare Workers
   only within ADR 0006.

### The BFF owns auth; Gitea tokens never reach the browser as cookies.

`services/api` handles login and signup. It mints a per-user Gitea token at
login time, stores it in its SQLite session store, and sets an `HttpOnly`
`bindersnap_session` cookie on the browser. The primary auth path is always the session cookie.
No bearer tokens in cookies. No Gitea credentials in `sessionStorage` or `localStorage`.

### Organization, workspace, folder, document.

An **organization** is a Gitea org and owns everything. A **workspace** is a Gitea
repository owned by that org — it is the binder: one set of rules, one set of
people. A **folder** is a directory inside it. A **document** is a file inside
that directory. Rules are the repo's branch protection, plus `.gitea/CODEOWNERS`
for per-folder reviewers. Billing keys to the organization, never to a username, a
workspace, or a document.

The rule: **different rules or different people means a new workspace; just
finding things means a new folder.**

A change is a pull request and may touch several documents; each document it
publishes gets its own tag on the shared merge commit. Retiring a document is
`git rm` in an approved change — the history stays.

Role teams, verified against Gitea 28.0.0 by
`tests/gitea-permission-model.pw.ts`: `<ws>-admins` is `permission: admin`,
`<ws>-authors` is write on `repo.code`/`repo.pulls`/`repo.issues`/`repo.releases`,
`<ws>-reviewers` is **read** on `repo.code`/`repo.pulls`/`repo.issues`. Read on
both units is all a reviewer needs to comment, approve and reject.

**Every workspace's branch protection must set `enable_approvals_whitelist: true`
with the three role teams in `approvals_whitelist_teams`.** Without it Gitea
resolves "official reviewer" as "has write access on `repo.code`", so a free
reviewer's approval is recorded and counts for nothing and their rejection blocks
nothing. This one field is what makes free reviewers real. `.gitea/CODEOWNERS` patterns are anchored regexes, not
gitignore globs — a folder rule is `policies/nursing/.*` — and the file is read
from the base branch, so a CODEOWNERS change never governs its own change.

**A sign-off rule blocks through `block_on_codeowner_reviews`** (Gitea 28.0.0):
for every CODEOWNERS rule matching a changed file, one of that rule's owners
must approve, whether the owner is a person or a team.
`block_on_official_review_requests` stays **off**. It never made a team code
owner block, because Gitea clears a team request's own `official` flag
(`AddTeamReviewRequest`), and left on it lets any member stall a publish by
requesting a review. `services/api/gitea-client/workspaces.ts` writes both, and
`services/api/requiredReviewers.ts` reads which gate a binder is under.
`tests/gitea-permission-model.pw.ts` asserts both gates side by side.

This is recorded in
`docs/adr/0004-organization-workspace-folder-and-org-billing.md`, it supersedes
ADR 0001's "one document equals one repository", and it is what runs.

### We bill the organization, never a person.

`subscriptions` and `subscription_access_overrides` key on `gitea_org_id`, not
on a username: Gitea renames organizations, and a person who signs up can
leave without taking their company's subscription with them. Stripe carries
`bindersnap_gitea_org_id` on the customer and the subscription;
`bindersnap_username` rides along as support metadata and is never a key.

`resolveAccess` is one precedence list, highest first — `admin_revoke`,
`admin_grant`, Stripe `active`/`trialing` with a 3-day grace, the local
`organizations.trial_ends_at`, then nothing. The 14-day trial is a local column
rather than a Stripe trialing subscription because #369 wants no card at all
during it, and keeping the whole thing in one function is what makes two
sources of access truth affordable.

Seats are derived from Gitea team membership on every call
(`listBillableSeats`), so there is no seat table to drift.

`scripts/backfill-org-billing.ts` maps the pre-re-key username rows, which
migration `0002` parked in `legacy_username_*` tables rather than dropping.
Those tables are deleted by hand, later, once the mapping has been checked.

### The paywall gates authoring, never reading.

`requireSubscription` guards mutation and nothing else. Reads and exports stay
open forever, whatever an organization owes us — holding a customer's approval
history hostage is the one act that would poison a compliance reference
permanently, and a surveyor's question does not pause for an invoice. Reads
authenticate with `requireSession` instead.

The rule is gated by intent, not by a route list, so a new `GET` that reaches
for `requireSubscription` is the bug. `services/api/paywall-scope.test.ts`
parses the router and fails on one, which is what ADR 0004 asks for in place of
a route-by-route audit.

When the paywall does bite it bites the organization, not the person: a
delinquent org's reviewers are blocked from mutating too.

### Evidence lives in Gitea. Configuration lives in SQLite.

Three questions, in order, from
`docs/adr/0004-organization-workspace-folder-and-org-billing.md`:

1. **Does Gitea model it natively?** Branch protection, org membership, teams and
   their unit permissions, PR reviews, assignees, review requests, reactions,
   topics. Use the Gitea primitive and **never shadow it** — when a copy
   disagrees with Gitea, the one Gitea enforced at merge is the one that counts.
2. **Is it evidence** — a fact about what happened that a surveyor could ask us to
   prove? Documents, versions, approvals, reviews, comments, tags. **It is a git
   object in the document's repo, permanently.** Never SQLite, not even as an
   optimization.
3. **Everything else is configuration** — workspace names, folder trees,
   departments, review cadence, per-document policy, billing. **A typed, indexed,
   migrated SQLite table.** Not a file in a git repo: git cannot query, so any
   question spanning documents becomes N network calls.

**When configuration shapes evidence, stamp it onto the event.** The policy in
force at a publish is written into the annotated tag and merge commit, not looked
up later from a versioned config file.

A **derived index** in SQLite is allowed only if it is rebuildable from Gitea from
scratch, is never written by a request handler as its primary action, and loses
nothing but speed when dropped. Every row keys on an immutable git coordinate (a
tag name, a commit SHA) so it is either correct or detectably stale, never subtly
wrong. **The index serves browsing; Gitea serves proving** — no publish gate,
approval check, or audit export may read it. Anything else that duplicates Gitea
state is a cache, and caches are still banned.

`.gitea/CODEOWNERS` is the one configuration that belongs in git: it is read at
pull-request time and lives on the same timeline as the content it governs, so
`?ref=<tag>` answers "who owned this policy when this version was approved."

A document's **identity** is a ULID carried as a segment of its filename —
`nursing/hand-hygiene.01J8XZ4K7M….md` — and its version tags are keyed on that
ULID rather than on its path (`01J8XZ4K7M…/v4`), so renaming a policy cannot
restart its numbering. See `docs/adr/0005-document-identity-and-version-tags.md`
and `packages/utils/documentUid.ts`. Its title stays the
filename, which is already point-in-time evidence: the tree at each version's tag
records what the document was called when that version was approved. The derived
index above stays deferred.

**Review threads** follow the same rule. Gitea has no thread primitive (its
review comments are anchored to a file path and line, which is meaningless for
a binary .docx), so threads are modelled as pull-request issue comments
carrying a trailing `<!-- bindersnap:v1 ... -->` marker. Resolution is an
**append-only event log** — resolving posts a new comment rather than editing
the root — because an audit product must never lose the history of who
reopened a concern. See `services/api/gitea-client/discussions.ts`.

**Reactions** on review comments are Gitea comment reactions, nothing more.
The vocabulary is five keys — `+1`, `-1`, `confused`, `eyes`, `heart` — all
inside Gitea's default allow-list, so no Gitea config change is involved. A
reaction is deliberately not part of the approval record: it never counts
toward `unresolvedCount`, never gates publishing, and never stands in for a
review. It exists so that agreeing with a concern costs the record nothing
instead of a fourth comment reading "+1". See
`services/api/gitea-client/reactions.ts`.

**Change assignments** follow the rule too. A change's assignee is the pull
request's Gitea assignee and its reviewers are Gitea review requests, so who a
change is waiting on is part of the same record as the reviews themselves. The
reviewer states the UI shows are derived from those two facts plus the reviews
(`services/api/change-assignments.ts`) — nothing about an assignment is stored
outside Gitea.

**A binder's review policy** — what branch protection cannot express, today
"refuse to publish while a review thread is unresolved" — is a SQLite row
(`services/api/workspace-settings.ts`), with every change logged in
`settings_events`. It replaced a `bindersnap-config` branch; do not bring that
pattern back. What the policy was when a version was published is stamped into
that version's tag. "Reset approvals on a new version" is Gitea's own
`dismiss_stale_approvals`, on the branch protection, so Gitea enforces it at
merge.

### File uploads flow browser → BFF → Gitea.

The upload flow for the file vault:

1. User selects file
2. SPA validates client-side (size ≤ 25 MiB; any extension allowed)
3. SPA sends a multipart form to the BFF (`POST /api/app/binders/:org/:binder/documents`
   for a new document, `.../document-revisions` for a new version)
4. BFF reads the file as base64 and commits it through the Gitea contents API
   — into the named draft or change, otherwise onto a new change request.
   `main` is protected, so nothing writes to it directly

There is no multipart endpoint that bypasses the BFF. The BFF is always the
server that writes to Gitea. File type and size validation happen client-side
before any API call.

See `docs/adr/0001-external-file-workflow-contract.md` for the full
upload/review/publish contract. **That ADR is law for the file vault workflow.**

### Production is one EC2 host, deployed by pushing with pyinfra.

No serverless backend. The backend is a Docker Compose stack on a single EC2
instance, and `deploy/` is the only thing that configures it. Do not add a
Lambda, an Aurora cluster, an API Gateway, a config bucket, or a bootstrap
script to Terraform user-data. Do not add a pull agent to the host. Deployment
logic goes in `deploy/deploy.py`, in Python, in version control.

**Cloudflare Workers are the one exception, and a narrow one.** A Worker may
run our code only if it is stateless, keeps no customer content, sits off the
critical path, and never touches Gitea or the API's databases. Today that is
`bindersnap-feedback` (in-app feedback → a private GitHub repository) and
nothing else; `bindersnap-site` and `bindersnap-app` serve static files and run
no code. Auth,
sessions, jobs, webhooks and anything that reads evidence or configuration stay
in the BFF. See `docs/adr/0006-cloudflare-workers-at-the-edge.md`.

See `docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md`. Note that
`docs/adr/0002-mvp-backend-aws-s3-dynamodb-cognito.md` describes an
AWS-native backend that was **reversed** — it is history, not guidance.

### The MVP is a document repository, not an editor.

The file vault workflow does not use the inline editor. Users upload files
authored externally (Word, Excel, PDF). Bindersnap provides version control and
approvals on top of those files via Gitea PR primitives.

The inline editor (`packages/editor/`) is a parallel workflow for documents
authored inside Bindersnap. These two workflows are independent. Do not
conflate them.

---

## What is Bindersnap?

Bindersnap is a pre-launch document management SaaS targeting regulated industries
(legal, compliance, healthcare, finance). It replaces the fragmented stack of
Word + email + shared drives with a single collaborative workspace that has a
real, tamper-proof approval trail built in.

**The one-liner:** Kill the email approval chain.

**The problem it solves:** Teams in regulated industries manage document approvals
through reply-all email threads, mismatched file versions, and no clear record of
who signed off on what. The canonical villain is the filename:

```
contract_FINAL_v2_JanEdits_APPROVED(1).docx
```

**The three pillars:**

| Pillar      | Reference                   | What it means                                               |
| ----------- | --------------------------- | ----------------------------------------------------------- |
| Write       | As easy as Word             | Rich document editor, no training needed                    |
| Collaborate | Real-time like Notion       | Live co-editing, inline comments, presence                  |
| Approve     | Version control like GitHub | PR-style diffs, explicit sign-off, locked approved versions |

**The core differentiator:** The audit trail is the product — not a feature. You
cannot modify an approved document without creating a new reviewable version. The
record is always clean, complete, and exportable for regulators.

**Target user (Primary ICP):** Compliance or operations manager at a
regulated-adjacent company. Age 28–45. Non-technical. Currently stitching together
Word + email + a shared drive to run approvals. Has been burned by "which version
did we approve?" at least once. Would pay for a tool that gives a clean audit trail
without IT involvement.

---

## Design Philosophy

The Bindersnap visual identity is **warm, human, and empathy-first** — not
corporate, not cold, not "enterprise software." Every design decision flows from
a single principle:

> _If it doesn't feel like it was built by someone who lived the problem, rebuild it._

**Three design rules to internalize before touching anything:**

1. **Empathy before product.** Lead with the pain, not the feature. The hero of
   any page is the problem the user recognizes — the product is the resolution.

2. **Coral is the hero, not the chorus.** Use `--brand-coral` for exactly ONE
   primary action or emphasis element per section. When everything is coral,
   nothing is.

3. **Paper over white.** The default background is `--bs-page-bg` (`#FAFAF7`),
   not pure `#FFFFFF`. White is reserved for card interiors only.

---

## Design System Files

The complete token system and social media guidelines live in two files. Always
reference these before writing any styles or generating any visual assets:

- **CSS tokens:** [`packages/ui-tokens/css/bindersnap-tokens.css`](packages/ui-tokens/css/bindersnap-tokens.css)
- **Social media & brand cheat sheet:** [`docs/bindersnap-social-cheatsheet.html`](docs/bindersnap-social-cheatsheet.html)
- **Open design system work:** [`docs/design/design-system-audit.md`](docs/design/design-system-audit.md)

### `packages/ui-tokens/css/bindersnap-tokens.css`

This is the single source of truth for all visual values. Import it once at the
root of your stylesheet. **Never hardcode hex values or pixel sizes in component
files** — always use the CSS variables defined here.

The token system has two layers:

- **`--bs-*` semantic tokens** — what components use. They flip in dark mode
  (`--bs-page-bg`, `--bs-surface-1`…`--bs-surface-3`, `--bs-text-primary`,
  `--bs-text-secondary`, `--bs-text-muted`, `--bs-text-faint`, `--bs-rule`,
  `--bs-rule-warm`, `--bs-shadow-sm`…`--bs-shadow-xl`, `--bs-coral-dim`,
  `--bs-coral-glow`, `--bs-coral-text`, `--bs-cta-fill`,
  `--bs-cta-fill-hover`, `--bs-green-dim`, `--bs-status-warn-*`,
  `--bs-status-info-*`, `--bs-status-danger-*`, `--bs-status-ok-*`,
  `--bs-coral-border`, `--bs-coral-border-soft`, `--bs-green-border`,
  `--bs-green-border-soft`).
- **`--brand-*` fixed tokens** — never change between modes
  (`--brand-coral`, `--brand-coral-dark`, `--brand-green`,
  `--brand-font-serif`, `--brand-font-sans`, `--brand-font-mono`,
  `--brand-text-*` type scale, `--brand-space-*` spacing scale,
  `--brand-radius-*`, `--brand-shadow-coral`, `--brand-transition-*`,
  `--brand-z-*`, plus a small set of intentionally-fixed values —
  `--brand-ink`, `--brand-on-brand`, `--brand-scrim*`, `--brand-mockup-*`,
  `--brand-mac-*` — for sections and mockups that stay the same regardless
  of theme).

**Rule: components always reference `--bs-*` semantic tokens. Never
reference `--brand-*` directly in component styles unless the value is
intentionally fixed across modes** (e.g. the chaos strip is always dark
ink, the email-thread mockup is always a light UI).

Key token categories, using the real names as defined in the token file:

```css
/* Semantic surfaces / text / borders (--bs-*, flip with theme) */
--bs-page-bg, --bs-surface-1, --bs-surface-2, --bs-surface-3, --bs-nav-bg
--bs-text-primary, --bs-text-secondary, --bs-text-muted, --bs-text-faint
--bs-rule, --bs-rule-warm

/* Coral that has to stay legible in both themes (--bs-*, flip with theme) */
--bs-cta-fill, --bs-cta-fill-hover   /* filled primary button       */
--bs-coral-text                      /* coral labels, links, emphasis */

/* Semantic status ramp (--bs-*, flip with theme) */
--bs-status-warn-fg, --bs-status-warn-bg, --bs-status-warn-border      /* needs review        */
--bs-status-info-fg, --bs-status-info-bg, --bs-status-info-border      /* waiting             */
--bs-status-danger-fg, --bs-status-danger-bg, --bs-status-danger-border /* changes / declined */
--bs-status-ok-fg, --bs-status-ok-bg, --bs-status-ok-border            /* approved            */

/* Fixed brand colors (--brand-*, never flip) */
--brand-coral, --brand-coral-dark, --brand-coral-mid
--brand-green, --brand-green-dim
--brand-ink                          /* chaos strip / footer fill   */
--brand-on-brand                     /* text/icon on a solid fill   */

/* Typography (--brand-*) */
--brand-font-serif    /* 'Lora' — headlines only */
--brand-font-sans     /* 'Geist' — body and UI */
--brand-font-mono     /* 'Geist Mono' — labels, code, metadata */

/* Type scale (--brand-*) */
--brand-text-h1, --brand-text-h2, --brand-text-h3
--brand-text-body-lg, --brand-text-body, --brand-text-sm, --brand-text-xs
--brand-text-label
--brand-text-ui-xs, --brand-text-ui-sm, --brand-text-ui-md  /* dense UI */

/* Spacing (--brand-*, base-8 with three sub-8 steps for dense UI) */
--brand-space-1, --brand-space-2, --brand-space-3, --brand-space-4,
--brand-space-5, --brand-space-6, --brand-space-8, --brand-space-10,
--brand-space-12, --brand-space-16, --brand-space-20, --brand-space-24,
--brand-space-30
--brand-space-0-5, --brand-space-1-5, --brand-space-2-5

/* Border radius (--brand-*) */
--brand-radius-xs, --brand-radius-sm, --brand-radius-md, --brand-radius-lg,
--brand-radius-xl, --brand-radius-2xl, --brand-radius-full

/* Shadows */
--bs-shadow-sm, --bs-shadow-md, --bs-shadow-lg, --bs-shadow-xl  /* flip with theme */
--brand-shadow-coral                                            /* fixed */
--bs-elevation-card, --bs-elevation-menu, --bs-elevation-modal   /* named by role */

/* Transitions (--brand-*) */
--brand-transition-fast (0.15s), --brand-transition-base (0.2s)
--brand-transition-slow (0.3s), --brand-transition-reveal (0.7s)

/* Icons (--brand-*) */
--brand-icon-xs, --brand-icon-sm, --brand-icon-md, --brand-icon-lg
--brand-icon-stroke, --brand-icon-stroke-heavy
```

The file also includes pre-built utility classes for common patterns:
`.bs-btn` (`.bs-btn-primary`, `.bs-btn-secondary`, `.bs-btn-dark`, size and
danger modifiers), `.bs-card`, `.bs-input`, `.bs-eyebrow`, `.bs-label`,
`.bs-status` (tone modifiers). The landing page's own primitives live in
`apps/site/landing.css`; see `apps/site/AGENTS.md`.

---

## Typography Rules

Typography is non-negotiable. The three-font stack is intentional and each font
has an exclusive job:

| Font           | Role                                                           | Rule                                                                                      |
| -------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Lora**       | All headlines (H1–H3), pull quotes, display text               | Warm, literary, serif. Use Bold or SemiBold. Italic for `<em>` accent phrases in coral.   |
| **Geist**      | All body copy, UI labels, buttons, navigation                  | Clean, modern. Light (300) for hero subtext, Regular (400) for body, Medium (500) for UI. |
| **Geist Mono** | Section eyebrow tags, code, filenames, timestamps, data labels | Fixed-width, technical. Always uppercase + wide letter-spacing for section labels.        |

**Never mix fonts within a heading level.** Never use Lora for body copy. Never
use Geist for a main headline.

---

## Color Usage Rules

Reference `packages/ui-tokens/css/bindersnap-tokens.css` for all values.

**Coral (`--brand-coral`, `#E85D26`):**
Used for CTAs, the top-border reveal on hover cards, section eyebrow labels,
form focus rings, and key emphasis. Maximum one coral element
per section. Never use coral decoratively.

White on `--brand-coral` measures 3.49:1 and fails WCAG AA. That constrains
every coral filled button, and the fix depends on what the label is:

- **Landing CTAs** (hero, closing, nav) fill with `--brand-coral` and set the
  label in `--brand-on-coral` — ink, 5.02:1. This keeps the page's buttons the
  exact colour of the hero's _approved._ On hover the fill darkens to
  `--brand-coral-dark` and the label flips to `--brand-on-brand` (4.61:1).
- **White-label buttons** (in-app primaries, where an ink label would read as
  disabled in dense UI) fill with `--bs-cta-fill` / `--bs-cta-fill-hover` —
  the coral hue at full chroma, dropped in lightness until white clears 4.5:1.

Never fill a button with `--brand-coral` and put white on it.

**Ink (`--bs-text-primary`, `#1C1917` in light mode):**
Primary text color. Dark backgrounds that are intentionally fixed regardless
of theme (nav bar in some contexts, the chaos strip, the footer) use
`--brand-ink`. Not pure black — this is a warm charcoal.

**Paper (`--bs-page-bg`, `#FAFAF7` in light mode):**
Default page background. Never use `#FFFFFF` as a page background. White is
reserved for card and input interiors only (`--bs-surface-1`).

**Paper Warm (`--bs-surface-2`, `#F5F0E8` in light mode):**
Alternating section backgrounds, card backgrounds, tag fills.

**Muted (`--bs-text-muted`) and faint (`--bs-text-faint`):**
`--bs-text-muted` is secondary body text. `--bs-text-faint` is the floor —
placeholders and hints only — never use anything lighter for text that must
be readable.

**Green (`--brand-green`, `#16A34A`):**
Success states, compliance badges, "after" column in comparisons, the live dot
in the nav badge. Not an accent — only use for positive/success semantic meaning.

**Status ramp (`--bs-status-warn-*`, `--bs-status-info-*`,
`--bs-status-danger-*`, `--bs-status-ok-*`):**
Use these — never a hand-picked hex — for anything that isn't plain coral or
green: needs-review (amber), waiting (blue), declined/changes (a coral-adjacent
but distinct hue), approved (green). Each is a `-fg`/`-bg`/`-border` triad and
each flips in dark mode; a literal amber or blue will pass contrast in light
mode and silently fail it in dark mode.

---

## Spacing

Spacing is base-8 from 12px up: use `--brand-space-*` tokens from the CSS file
(4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120px — `--brand-space-1`
through `--brand-space-30`). Below 12px, three sub-8 steps exist for dense UI
(chips, icon rows, table cells): `--brand-space-0-5` (2px), `--brand-space-1-5`
(6px), `--brand-space-2-5` (10px). Use one of these thirteen tokens — never a
raw pixel value. Section vertical padding is `--brand-space-30` (120px) by
default, `--brand-space-24` (96px) for compressed sections.

---

## Border Radius

Each radius value has a specific semantic use. Do not apply them arbitrarily:

| Token                 | Value  | Use                                           |
| --------------------- | ------ | --------------------------------------------- |
| `--brand-radius-xs`   | 2px    | Code blocks, compliance badges, table rows    |
| `--brand-radius-sm`   | 4px    | Tags, pills, small chips                      |
| `--brand-radius-md`   | 8px    | Nav elements, feature icons, small cards      |
| `--brand-radius-lg`   | 12px   | Inputs, form elements, standard cards         |
| `--brand-radius-xl`   | 16px   | Large cards, feature panels, comparison boxes |
| `--brand-radius-2xl`  | 24px   | CTA boxes, hero containers, modal dialogs     |
| `--brand-radius-full` | 9999px | Pills, avatar badges, the nav badge           |

---

## Voice & Copy

When generating any copy — marketing text, UI labels, error messages,
documentation, email subjects — follow these rules:

**Do:**

- Lead with the pain before the product
- Use short, active sentences
- Be direct: make claims you can back up, don't hedge with "may" or "might"
- Use the document chaos as a hook when relevant: `contract_FINAL_v2_JanEdits_APPROVED(1).docx`
- Keep UI copy warm and human — write as if a helpful colleague wrote it

**Don't:**

- Use enterprise jargon: leverage, synergize, paradigm, ecosystem, streamline
- Bury the value proposition behind feature descriptions
- Use passive voice for anything action-oriented
- Write anything that sounds like it came from a compliance manual

**Proven headline formulas:**

```
Pain → Resolution:  "Your approval process is a mess. We fixed it."
Enemy → Hero:       "Kill the email approval chain. Finally."
Question hook:      "Wait — which version did we actually sign off on?"
Before/After:       "From reply-all chaos to a clean audit trail — in one tool."
```

---

## Component Patterns

### Section eyebrow label

Every section opens with a mono label in coral with flanking line decorations:

```html
<div class="bs-eyebrow">The Solution</div>
```

### Card hover pattern

Cards use `.bs-card`. On hover: translate up 4px, elevate shadow, border
becomes transparent, and a 3px coral top border scales in from the left via
`scaleX`. Never apply this pattern to non-interactive content.

The landing page's own patterns — sign-up form, scroll rhythm, scroll reveal,
dark sections — are in `apps/site/AGENTS.md`.

---

## What Bindersnap Is NOT

Agents should never frame Bindersnap as any of the following:

- An "AI-powered" tool (we don't lead with AI)
- "Enterprise software" (we're bottom-up, team-first)
- A competitor to DocuSign (we're upstream — the writing and collaboration layer)
- A project management tool (we're document-specific)
- A replacement for Word (we're an upgrade to the approval workflow around documents)

The positioning is: **the only document tool where the approval trail is the
product, not a plugin.**

---

## File Conventions

When generating new pages, components, or templates:

1. Import `packages/ui-tokens/css/bindersnap-tokens.css` before any other stylesheet
2. Components always reference `--bs-*` semantic tokens. Never reference
   `--brand-*` directly in component styles unless the value is
   intentionally fixed across modes — zero hardcoded values
3. Check `docs/bindersnap-social-cheatsheet.html` for exact dimensions before
   generating any image assets or meta tags
4. Default background is always `var(--bs-page-bg)` (`#FAFAF7`), never `#fff`

---

## GitHub Agent Workflow Policy

This repository uses either `gh` CLI or an MCP tool.

### Tool mapping

- Read: `issue_read`, `pull_request_read`, `list_issues`, `list_pull_requests`
- Write: `create_branch`, `create_or_update_file`, `create_pull_request`, `update_pull_request`, `add_issue_comment`, `pull_request_review_write`

### Git ownership split

- Use local `git` for working tree operations (edit, stage, commit, diff)
- Use `gh` or MCP for GitHub API operations (issue, branch, PR, comments, reviews)

---

## Gitea service tokens

**Service account tokens are split by power.** `BINDERSNAP_GITEA_SERVICE_TOKEN` (read scopes only) must be set; the API exits at startup if it is missing in production. `BINDERSNAP_GITEA_ADMIN_TOKEN` (`write:admin` only) is used solely for signup, password changes, account deletion and token revocation. Never give the read token a write scope, and never use the admin token for a read: the read token runs on nearly every request. Anything a person can do in Gitea themselves — renaming their own draft, say — is done with their own session token, not either of these.

The rest of the production security rules are in `deploy/AGENTS.md`.

---

## Deterministic MCP Setup

Use one GitHub MCP server configuration path at a time. Avoid mixed auth paths
(for example OAuth + PAT at once) to prevent nondeterministic write failures.
