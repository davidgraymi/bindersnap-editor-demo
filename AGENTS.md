# AGENTS.md — Bindersnap Codebase Guide

For AI agents and automated tools working in this repository: what Bindersnap
is, how to run and test it, and the rules for changing its code, copy and
design.

This is the one instruction file. Every `CLAUDE.md` holds only `@AGENTS.md`, so
Claude Code reads the same text as every other agent. Put new instructions in an
`AGENTS.md`, never in a `CLAUDE.md`. Three directories have their own guide,
which loads when you work there:

- `apps/app/AGENTS.md` — the document editor, the change comparison, the
  conflict resolver
- `apps/site/AGENTS.md` — the public site and the landing page's patterns
- `deploy/AGENTS.md` — how a production deploy runs, and the host's security
  rules

Rules that matter only for one kind of task live in `.claude/skills/`, which
Claude Code loads when the task calls for it. Any agent can read them as plain
Markdown, and this file points to each one where it applies:

- `.claude/skills/stack/SKILL.md` — running and validating against the stack
- `.claude/skills/design-system/SKILL.md` — tokens, type, color, components
- `.claude/skills/voice-and-copy/SKILL.md` — every word a person reads
- `.claude/skills/stacked-pr/SKILL.md` — commits, PRs and stacks
- `.claude/skills/gitea-api/SKILL.md` — the BFF's Gitea client and tokens

Claude Code's subagents are in `.claude/agents/`: `stack-reviewer` (a PR
against its real base), `bindersnap-tester`, `gitea-evidence-auditor`
(non-negotiables 1 and 2), the three Playwright agents, and two that run only
when asked, `legal-reviewer` and `copy-editor`.

A new directory guide needs a sibling `CLAUDE.md` containing `@AGENTS.md`, and
an entry in `AGENTS_MD_PATHS` in `packages/ui-tokens/tokens.test.ts`, which
checks that every token name the guides mention exists.

---

## What Bindersnap is

**Policy and procedure management for small healthcare providers**: clinics,
ambulatory surgery centers, home health agencies, hospices, behavioral health
programs and rural health clinics. Each policy keeps its current approved
version and a record of who signed off on it, so when a surveyor asks which
version was approved, the answer is on the page.

- **The audit trail is the product, not a feature.** An approved version cannot
  change without a new, reviewable version. The record is complete and exportable.
- **Primary user:** the compliance or operations lead at a small provider. Not
  technical. Runs approvals today through Word, email and a shared drive, and
  has been asked "which version did we approve?" without a good answer.
- **Pricing:** $39 a month per writer (Owner, Admin, Editor). Reviewers and
  readers are free. A person's first organization starts with a 14-day trial,
  no card; any organization they create after that is paid for from the start.
- **Bindersnap holds no patient data.** Never call it "HIPAA compliant".
- The app calls them **documents**; marketing copy may say "policy".

The villain is the filename: `IC_Policy_FINAL_APPROVED_Mar14.docx`.

---

## The non-negotiables

Settled. Do not reopen them or work around them. If a task seems to require
breaking one, stop and open a `human-needed` issue. Each is explained under
"Architecture decisions" below.

1. **The BFF owns auth; Gitea tokens stay server-side.** The browser holds only
   an `HttpOnly` session cookie.
2. **Evidence lives in Gitea; configuration lives in SQLite.** Documents,
   versions, approvals, reviews, comments and tags are git objects, never
   SQLite rows. See ADR 0004.
3. **File uploads flow browser → BFF → Gitea.** ADR 0001 is law, except its
   "one document = one repository", superseded by ADR 0004.
4. **Two independent workflows.** The file vault (uploaded Word, PDF and other
   files) and the inline editor are separate. Do not conflate them.
5. **Editor UI changes need a flag.** If you change `packages/editor/` visuals,
   note it in your PR.
6. **`deploy/` configures the host; Terraform does not.** No serverless backend,
   no config bucket, no bootstrap logic in `user-data.sh`. Cloudflare Workers
   only within ADR 0006.

---

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Run the app (Gitea + seed + API + Caddy + Mailpit + app)
bun run up            # Start this worktree's stack; waits until ready, then exits
bun run down          # Tear down this worktree's stack, and only this one
bun run stack status  # Your ports, your URLs, your login — add --json to parse

# Partial servers — neither gives you a working app on its own
bun run dev:app       # The app shell on APP_PORT and the public site (landing,
                      # marketing, help, legal) on SITE_PORT. Calls no API.
bun run dev:api       # API only: still needs Gitea, which only `bun run up` runs.

# Build
bun run build         # Build the app and the site to dist/

# Tests
bun run test          # All unit tests (test:app + test:ops + test:seed)
bun run test:app      # apps/app, apps/help, apps/legal, apps/site, packages/api-client, packages/editor, packages/utils, packages/ui-tokens
bun run test:ops      # services/api, services/feedback, services/uptime, scripts, infra/backups
bun run test:seed     # The seed scenario and its documents
bun run test:integration  # Playwright — starts and stops its own stack
                          # SKIP_STACK=1 reuses a running `bun run up` stack
                          # Both find this worktree's ports on their own
bun test path/to/file.test.ts  # Single file

# Generated code — commit what these write
bun run generate:bff  # After changing an API schema in packages/api-schema:
                      # rewrites openapi.json, then packages/api-client from it
bun run db:generate   # After editing services/api/db/schema.ts: a new migration

# Code formatting
bun run format        # Format all source files
bun run format:check  # Check without writing
```

Unit tests live next to their source as `*.test.ts`; Playwright tests are
`tests/*.pw.ts`. CI (`pr-verify.yml`) runs `format:check`, the three unit
suites, `bun run build` and the integration tests.

**CI does not typecheck.** `tsconfig.json` is strict, but `bunx tsc --noEmit -p .`
reports existing errors, most of them in tests. Run it on what you change and
add no new errors to files you touch.

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
   Claude Code refuses both: `.claude/settings.json` denies them, and its
   `scripts/claude-hooks/guard-bash.ts` hook blocks a `docker compose` hidden
   inside a longer command.
2. **Never assume port 5173.** Your worktree gets its own port block, claimed
   automatically on first use and recorded in `.env`. Ask for it:
   `bun run stack status` (or `--json` for `ports`, `urls`, `stackName`,
   `running`).
3. **`bun run up` exits when the stack is ready** — it is safe to await. It
   builds, starts detached, waits for Gitea, the API, the proxy and the app to
   answer, then prints your URLs and the seeded password. Use `bun run up:fg`
   only if a human wants the log stream; it never returns.
4. **`bun run down` before you delete a worktree.** A running stack holds files
   in `data/`, which is what makes `git worktree remove` fail. If a worktree is
   already gone, `bun run stack prune` tears down its orphaned stack and frees
   its ports.

Everything else — other `stack` commands, the seeded accounts and binders,
integration tests, signing in, the CORS trap that stops a second SPA, and what
to do after a dependency change — is in `.claude/skills/stack/SKILL.md`. Read
it before you open the app in a browser.

---

## Repo map

```
bindersnap-editor-demo/
├── apps/
│   ├── app/              ← The app, app.bindersnap.com (static files on Cloudflare)
│   │   ├── App.tsx       ← Auth gate + routing
│   │   ├── api.ts        ← All browser-to-API calls (BFF client)
│   │   ├── routes.ts     ← Client-side route definitions
│   │   └── components/   ← App shell, binder and document UI
│   ├── site/             ← The public site, bindersnap.com: landing + marketing
│   ├── help/             ← bindersnap.com/help
│   └── legal/            ← bindersnap.com/legal
├── packages/
│   ├── editor/           ← Tiptap editor, imported by the app (README: read first)
│   ├── api-schema/       ← Zod schemas → openapi.json for the BFF
│   ├── api-client/       ← Typed client generated from that schema
│   ├── ui-tokens/        ← CSS design tokens, fonts, icons
│   └── utils/            ← Shared code: sanitizer, document UIDs, CODEOWNERS
├── services/
│   ├── api/              ← The BFF: auth + data (Bun). README: env vars
│   ├── hocuspocus/       ← Yjs collaboration server; no stack runs it (no real-time editing yet)
│   └── feedback/         ← Cloudflare Worker: in-app feedback and error reports → GitHub issues (ADR 0006)
├── deploy/               ← Configuration as code: pyinfra push deploy to the one host
├── infra/                ← Terraform only
│   ├── compute/          ← The EC2 host
│   ├── edge/             ← Cloudflare: DNS, tunnel, email routing
│   ├── email/            ← SES
│   ├── billing/, billing-test/  ← Stripe catalog (live, and CI's test mode)
│   ├── account-baseline/ ← CloudTrail, GuardDuty, budgets
│   └── backups/, ci/, monitoring/, secrets/, state/
├── tests/                ← Playwright (*.pw.ts) and the seed (seed-data/dev.yaml)
├── scripts/              ← stack.ts (the local stack), builds, one-off tools
├── docs/                 ← ADRs (docs/adr), ops runbooks (docs/ops), design specs
├── server.ts             ← Bun dev server: the app on APP_PORT, the site on SITE_PORT
├── docker-compose.yml    ← The local stack
└── Dockerfile            ← Dev image for the app and api containers
```

`TECHNICAL_VISION.md` is older than most of this file. Where they disagree,
this file and the ADRs win.

### The app

`apps/app/` is the app at `app.bindersnap.com`, a React SPA. It holds no
landing page: that is `apps/site/`, on `bindersnap.com`.

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
    `/{org}/-/billing`
  - `/-/admin` — the site admin console, Gitea site admins only: health
    checks, then `/-/admin/users` (and creating an account),
    `/-/admin/organizations` (and giving one free access, for a number of
    days, writers, or both), `/-/admin/binders`, `/-/admin/signups`
    (which page of bindersnap.com each signup came from, and who went on to
    pay: `signup_sources`, never Google), `/-/admin/growth` (from signup to
    a published version and paying, and every trial's progress, from the
    activity dataset), `/-/admin/system`
    (versions, the pinned images,
    memory, disk, maintenance) and `/-/admin/config` (every setting; a secret
    only as set or not, `services/api/admin-system.ts`)
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
Markdown in `apps/site/content/`. See `apps/site/AGENTS.md`.

### The editor, the comparison and the conflict resolver

Each is described in full in `apps/app/AGENTS.md`. What applies outside
`apps/app`:

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
`openapi.json`, which `packages/api-client` is typed from (`bun run generate:bff`).
The families:

- `/auth/*` — signup (creates the Gitea account and nothing else), login,
  logout, `me`, email verification, password reset. An account may have no
  organization: `POST /api/app/organizations` is the one place one is created,
  with its first binder (ADR 0004), and the app sends a person there when they
  first try to write
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

### Deployment

Everything except the static sites and the feedback Worker runs as Docker
Compose services on **one EC2 host**, deployed by **pushing with pyinfra** from
GitHub Actions. There is no serverless backend: Lambda, Aurora, API Gateway and
the Gitea-as-NAT plumbing were removed (epic #302). See
`docs/adr/0003-single-ec2-host-pyinfra-push-deploys.md`, and
`docs/adr/0006-cloudflare-workers-at-the-edge.md` for the Workers.

| Component | Host           | How deployed                                                          |
| --------- | -------------- | --------------------------------------------------------------------- |
| App (SPA) | Cloudflare     | `static-site.yml` (`wrangler deploy`) on push to `main`               |
| Site      | Cloudflare     | same workflow; `bindersnap.com`, landing/marketing/help/legal         |
| API       | EC2 via Docker | `deploy-pyinfra.yml` (pyinfra over SSH-through-SSM) on push to `main` |
| Gitea     | Same EC2 host  | `docker-compose.prod.yml`, same pyinfra run                           |
| Feedback  | Cloudflare     | `feedback-worker.yml` (`wrangler deploy`) on push to `main`           |

The app is built with `BUN_PUBLIC_API_BASE_URL=https://api.bindersnap.com`
baked in at compile time. Locally every address comes from your stack's ports;
`bun run stack status` prints them.

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
`deploy/AGENTS.md`. Read `deploy/README.md` before changing anything under
`deploy/`, `docs/ops/deploy.md` for the pipeline and required GitHub variables,
and `docs/ops/break-glass.md` for recovering the host over SSM when CI is
unavailable.

---

## Architecture decisions

The detail behind the non-negotiables, and the rules that follow from them.

### The BFF owns auth; Gitea tokens never reach the browser.

`services/api` handles login and signup. It mints a per-user Gitea token at
login, keeps it in its SQLite session store (`services/api/sessions.ts`), and
sets an `HttpOnly` `bindersnap_session` cookie. No response ever carries a Gitea
token — not `/auth/me`, not login (#662) — and nothing about Gitea goes into
`sessionStorage` or `localStorage`.

**The API's own Gitea tokens are split by power.** `BINDERSNAP_GITEA_SERVICE_TOKEN`
(read scopes only) must be set; the API exits at startup if it is missing in
production. `BINDERSNAP_GITEA_ADMIN_TOKEN` (`write:admin` only) is used solely
for creating an account (at signup, or by a site admin from `/-/admin/users`),
password changes, account deletion and token revocation. Never give
the read token a write scope, and never use the admin token for a read: the
read token runs on nearly every request. Anything a person can do in Gitea
themselves — renaming their own draft, say — is done with their own session
token, not either of these.

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
nothing. This one field is what makes free reviewers real. `.gitea/CODEOWNERS`
patterns are anchored regexes, not gitignore globs — a folder rule is
`policies/nursing/.*` — and the file is read from the base branch, so a
CODEOWNERS change never governs its own change.

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
`organizations.trial_ends_at`, then nothing. A grant may end on a date or
cover a number of writers; past either it is passed over and the list goes
on. The paywall counts writers from Gitea for that, and only for a grant
with a writer limit. The 14-day trial is a local column
rather than a Stripe trialing subscription because #369 wants no card at all
during it, and keeping the whole thing in one function is what makes two
sources of access truth affordable.

**The trial goes to a person's first organization only** (`resolveTrialEnd` in
`services/api/organizations.ts`). Anyone signed in may create as many
organizations as they like, and nothing limits it, but a trial on each would be
a free trial for every click. Checkout needs an organization and an Owner of it:
a person with none gets a 409 and is asked to create one, never a card form.

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
   migrated SQLite table** (`services/api/db/schema.ts`; `bun run db:generate`).
   Not a file in a git repo: git cannot query, so any question spanning
   documents becomes N network calls.

**When configuration shapes evidence, stamp it onto the event.** The policy in
force at a publish is written into the annotated tag and merge commit, not looked
up later from a versioned config file.

A **derived index** in SQLite is allowed only if it is rebuildable from Gitea from
scratch, is never written by a request handler as its primary action, and loses
nothing but speed when dropped. Every row keys on an immutable git coordinate (a
tag name, a commit SHA) so it is either correct or detectably stale, never subtly
wrong. **The index serves browsing; Gitea serves proving** — no publish gate,
approval check, or audit export may read it. Anything else that duplicates Gitea
state is a cache, and caches are banned. One has been built: the activity
dataset (`services/api/activity.ts`), behind the site admin's growth reports.

`.gitea/CODEOWNERS` is the one configuration that belongs in git: it is read at
pull-request time and lives on the same timeline as the content it governs, so
`?ref=<tag>` answers "who owned this policy when this version was approved."

A document's **identity** is a ULID carried as a segment of its filename —
`nursing/hand-hygiene.01J8XZ4K7M….md` — and its version tags are keyed on that
ULID rather than on its path (`01J8XZ4K7M…/v4`), so renaming a policy cannot
restart its numbering. See `docs/adr/0005-document-identity-and-version-tags.md`
and `packages/utils/documentUid.ts`. Its title stays the filename, which is
already point-in-time evidence: the tree at each version's tag records what the
document was called when that version was approved.

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
review. See `services/api/gitea-client/reactions.ts`.

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

1. The person picks a file. Any extension is allowed.
2. The app checks the size: at most 25 MiB (`apps/app/api.ts`). **That check is
   the only one** — the API does not enforce a size limit of its own.
3. The app sends a multipart form to the BFF:
   `POST /api/app/binders/:org/:binder/documents` for a new document,
   `.../document-revisions` for a new version.
4. The BFF reads the file as base64 and commits it through the Gitea contents
   API — into the named draft or change, otherwise onto a new change request.
   `main` is protected, so nothing writes to it directly.

There is no upload path that bypasses the BFF. See
`docs/adr/0001-external-file-workflow-contract.md` for the full
upload/review/publish contract. **That ADR is law for the file vault workflow**,
except where ADR 0004 supersedes it.

### Production is one EC2 host, deployed by pushing with pyinfra.

No serverless backend. The backend is a Docker Compose stack on a single EC2
instance, and `deploy/` is the only thing that configures it. Do not add a
Lambda, an Aurora cluster, an API Gateway, a config bucket, or a bootstrap
script to Terraform user-data. Do not add a pull agent to the host. Deployment
logic goes in `deploy/deploy.py`, in Python, in version control.

**Cloudflare Workers are the one exception, and a narrow one.** A Worker may
run our code only if it is stateless, keeps no customer content, sits off the
critical path, and never touches Gitea or the API's databases. Today that is
`bindersnap-feedback` (in-app feedback, and error reports from the app and the
API, → private GitHub repositories) and
`bindersnap-uptime` (checks `/healthz` every minute, emails on down and up; the
one Worker allowed a KV key, for its last result) and nothing else;
`bindersnap-site` and `bindersnap-app` serve static files and run no code. Auth, sessions, jobs, webhooks and anything that reads evidence or
configuration stay in the BFF.

`docs/adr/0002-mvp-backend-aws-s3-dynamodb-cognito.md` describes an AWS-native
backend that was **reversed** — it is history, not guidance.

### Two workflows: the file vault and the editor.

The file vault takes files written elsewhere — Word, Excel, PDF — and puts
version control and approvals on top of them through Gitea pull requests. The
inline editor (`packages/editor/`) is a separate workflow for documents written
inside Bindersnap, saved as `*.json`. A Word file or a PDF is never opened in
the editor; it is edited in the program that made it and uploaded as a new
version. Do not conflate the two.

---

## Design system

The visual identity is **warm, human, and empathy-first** — not corporate, not
"enterprise software". The tokens are `packages/ui-tokens/css/bindersnap-tokens.css`:
**never hardcode a hex value or a pixel size** in a component. Every other rule
— tokens by name, typography, color and contrast, spacing, radius, components —
is in `.claude/skills/design-system/SKILL.md`. Read it before any visual change.

---

## Voice and copy

Lead with the pain before the product, in short active sentences. The app says
**document**; never claim "HIPAA compliant". The full rules, and what Bindersnap
must never be framed as, are in `.claude/skills/voice-and-copy/SKILL.md`. Read
it before writing any text a person will see.

---

## Git and GitHub

- **Commits and PR titles** are Conventional Commits with a scope, written as a
  sentence about the result: `feat(auth): a Turnstile check on signup`,
  `fix(deploy): a deploy restarts only what it changed`. Squash-merged PRs get
  the number appended.
- **PR bodies** follow `.github/pull_request_template.md`: Summary, Scope Check,
  Validation with the commands you ran.
- **Large work ships as stacked PRs**, each based on the one before it, linked
  with `gh stack link`.
- **Releases are automatic.** `release.yml` bumps the version and the
  changelog in a `chore: release vX.Y.Z [skip ci]` commit. Do not edit
  `CHANGELOG.md` or the version by hand.
- How to build and push a stack, step by step: `.claude/skills/stacked-pr/SKILL.md`.
- Use local `git` for the working tree, and `gh` or a GitHub MCP server for
  issues, PRs and reviews. Use one GitHub MCP auth path at a time (not OAuth and
  a PAT together), or writes fail unpredictably.
