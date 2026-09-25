# Backend review: the BFF ↔ Gitea layer

_September 2026 · base: `development/binders-gitea-28` @ `a0439d8`_

The question was where the backend is weak, with two ideas to test:

1. **A queue**, because one browser request turns into two or more Gitea requests.
2. **A cache between the BFF and Gitea**, because the app loads slowly.

The short answers:

- **A durable, idempotent job queue is needed, and the gap is bigger than
  publishing.** Six user actions are a chain of separate Gitea writes with no
  record of intent. If the API process dies partway through, which a deploy
  or restart can cause, the chain stops and nothing finishes it. Two leave
  compliance damage. A publish can merge without writing its version tags. A
  new binder can be left with an **unprotected `main`**. In both cases,
  retrying from the UI is refused. §4 lists every such flow and proposes a
  write-ahead job table with idempotent steps. It uses SQLite in the API
  process, not SQS, and explains why.
- **The queue that already exists is a different kind.** Every Gitea call
  goes through a four-slot in-memory gate (`gitea-client/request-gate.ts`).
  It limits load; it doesn't make work durable. Pages are slow because of
  **how many calls each page makes**, and many of those calls fetch data the
  page never uses. Pages also run independent steps one after another. The
  gate limit was tuned on the dev stack, which runs Gitea's SQLite in a
  different journal mode from production (§2).
- **A general cache in front of Gitea is banned by this repo's own rules**, and
  on a compliance product that rule is correct (AGENTS.md: "Anything else that
  duplicates Gitea state is a cache, and caches are still banned."). Three
  cache-like techniques are allowed because none of them can show stale data:
  sharing one in-flight request between callers, memoizing within a single
  request, and caching data keyed by a git object that can never change. Those
  get most of the benefit. A webhook-invalidated read cache is possible, but it
  needs an ADR change first (§5).
- **Four bugs came up along the way.** They are more urgent than the
  performance work. The worst one breaks publishing once a binder has more than
  30 tags. I reproduced it against a real Gitea 1.27.3 (§3.1).

Everything below cites file and line on the base commit. The measurements come
from a throwaway Gitea 1.27.3 binary running on this machine, not the compose
stack (there is no Docker daemon in this environment). Read them as ratios,
not production latencies.

---

## 1. How a page reaches Gitea today

```
browser ──HTTP──▶ BFF handler ──▶ gitea-client fn ──▶ openapi-fetch ──▶ giteaRequestGate (4 slots, FIFO) ──▶ Gitea ──▶ SQLite
                       │
                       └──▶ giteaFetch() raw fetch ───────────────────────────────── (NOT gated) ──▶ Gitea
```

- **The gate** (`gitea-client/request-gate.ts:31`, `MAX_CONCURRENT_GITEA_REQUESTS = 4`)
  wraps `fetch` inside the typed client (`gitea-client/client.ts:7`), so every
  typed call waits for a slot. It is one queue for the whole process: one FIFO
  shared by every user.
- **Raw `giteaFetch`** (`server.ts:673`) skips the gate. It is used for login,
  token minting and revocation, `GET /user` (`/auth/me` and admin checks), user
  creation, and the raw document download (`server.ts:7764`).
- **Auth per call.** Session calls use the user's token. Privileged reads (branch
  protection, etc.) use the service token in production. The dev stack has no
  service token, so they **fall back to HTTP basic auth**
  (`privileged-client.ts:23`, `docker-compose.yml` sets no
  `BINDERSNAP_GITEA_SERVICE_TOKEN`).
- **No timeouts and no cancellation.** Nothing passes an `AbortSignal` to a
  Gitea call. If the browser navigates away, the handler keeps going and its
  queued calls still take up gate slots.
- **No visibility.** A request logs its `durationMs`, but not how many Gitea
  calls it made or how long it waited for a slot. So we can't currently tell
  "Gitea is slow" apart from "we asked Gitea too many times".

## 2. Measurements

Gitea 1.27.3 (the production tag) on SQLite, one repo, 30 open PRs. Each run is
120 authenticated GETs (`/pulls/N`, `/pulls/N/reviews`, `/repos/…`, `/user/orgs`),
median of 3 runs, at a fixed concurrency.

| in flight | rollback journal (Gitea default) |        WAL |
| --------: | -------------------------------: | ---------: |
|         1 |                          1627 ms |    1364 ms |
|         2 |                           865 ms |     752 ms |
|         4 |                       **905 ms** | **687 ms** |
|         8 |                          1436 ms |     660 ms |
|        16 |                          1866 ms |     727 ms |
|        32 |                      **2809 ms** | **844 ms** |

- The gate's own finding holds **in rollback-journal mode**: throughput peaks at
  2–4 in flight and collapses beyond that, because every token-authenticated call
  writes `updated_unix` and SQLite serializes writers.
- **In WAL mode the collapse mostly disappears.** 32 in flight is 3.3× faster
  than rollback mode, and 4 in flight is about 24% faster.
- **Basic auth costs about 3× a token call** (23 ms vs 7 ms per request,
  sequential), because Gitea hashes the password on every request. This only
  affects dev, but dev is where the gate limit was tuned and where "the app
  loads slowly" is usually noticed.

### What the infrastructure config says about Gitea's database

This comes from reading `docker-compose.yml`, `deploy/files/`, `infra/compute/`
and the pinned upstream sources:

| Setting               | Dev (`docker-compose.yml`)                                                                       | Prod (`deploy/files/docker-compose.prod.yml`)                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gitea                 | 28.0.0 nightly (pinned digest)                                                                   | `gitea/gitea:1.27.3`                                                                                                                                                                                                                                                                           |
| DB                    | SQLite, `/data/gitea.db`                                                                         | SQLite, `/data/gitea.db`                                                                                                                                                                                                                                                                       |
| `SQLITE_JOURNAL_MODE` | not set, so SQLite's default applies (Gitea's default is `""`, `modules/setting/database.go:75`) | not set                                                                                                                                                                                                                                                                                        |
| Litestream            | **none**                                                                                         | `litestream/litestream:0.3` replicates `gitea.db` and `sessions.db` (`litestream.yml`). On start, Litestream runs `PRAGMA journal_mode = wal` on each database (`db.go:432` at v0.3.13), and that mode is stored in the file. It starts after Gitea is healthy (`depends_on: service_healthy`) |
| Effective mode        | **rollback journal (`delete`)**                                                                  | **WAL**, set by Litestream as a side effect. Gitea itself never asks for it                                                                                                                                                                                                                    |
| `SQLITE_TIMEOUT`      | not set → 20 s busy timeout (Gitea raises any value below 5000 to 20000)                         | same                                                                                                                                                                                                                                                                                           |
| Privileged auth       | basic auth (no service token in compose)                                                         | service token (`BINDERSNAP_GITEA_SERVICE_TOKEN`)                                                                                                                                                                                                                                               |
| Host                  | developer machine                                                                                | one `t4g.small` (2 vCPU, 2 GiB, `infra/compute/main.tf:53`). Gitea, the API, Caddy, Litestream and the CloudWatch agent share it                                                                                                                                                               |

Three things follow from this:

1. **Dev and prod run Gitea's database in different modes.** The gate's
   comment says it was "measured against a seeded dev stack", so the limit of 4
   was tuned in rollback mode. That is the column where concurrency collapses.
   Production runs in WAL mode, where it doesn't collapse. The limit is
   probably conservative for prod, but prod is also a 2-vCPU host running four
   other processes. Re-measure there, or on a `t4g.small` running the prod
   compose file, before changing it (P1-1).
2. **Prod's WAL mode depends on a sidecar.** If Litestream is removed,
   replaced, or starts later, prod silently falls back to rollback mode, and
   every page gets the collapse shown in the left-hand column. Set
   `GITEA__database__SQLITE_JOURNAL_MODE=WAL` in **both** compose files so the
   mode is stated where it is relied on, and so dev behaves like prod.
3. **A Gitea stall shows up as slowness, not as errors.** With a 20 s busy
   timeout, a call stuck behind the write lock waits rather than failing.
   Together with the BFF having no timeout (P2-2), one slow Gitea write can
   hold a gate slot for up to 20 s.

## 3. Findings

Severity: **P0** is wrong data or a broken write. **P1** is a large, cheap
performance win. **P2** is resilience or observability. **P3** is structural.

### 3.1 P0: correctness

**P0-1. Publishing picks the wrong version number once a binder has more than
30 tags, and fails after the merge has already happened.**
`listDocumentVersions` (`gitea-client/workspaceDocuments.ts:333`) calls
`GET /repos/{o}/{r}/tags` without `page` or `limit`, so it gets **Gitea's
default page of 30**, newest first. I created one document's `v1`, then 34
other tags. The default page came back with 30 tags, and that document's `v1`
was on page 2. So:

- `handlePublishWorkspaceChange` computes `nextVersion = 1` for that document
  (`server.ts:3993–4005`), **merges** (`server.ts:4007`), and then
  `POST /tags` for `<uid>/v1` gets `409 tag already exists`, which I reproduced.
  The change ends up merged with no version tag. Nothing retries and nothing
  reconciles, so the evidence record now has a gap. This is the same failure
  as a crash between the merge and the tags (§4), just triggered by a bug.
- The document page (`server.ts:7673`) shows that document with no versions and
  can mark it `proposed` (`server.ts:7690`).
- The change page (`server.ts:4281`) labels the button "Publish v1".

Fix: build versions from `listAllTags` (paginated) and
`groupVersionsByDocument`. The change-detail handler already fetches every tag
(`server.ts:4247`) and then ignores them for this. Add a test with more than
30 tags.

**P0-2. Version tags point at `main`, not at the merge commit.**
`createDocumentVersionTag` says it points "at the merge commit"
(`workspaceDocuments.ts:601`), but publish passes `target: "main"`
(`server.ts:4055`, and the archive tags at `server.ts:4106`). If two changes
in the same binder publish close together, the first change's tags can land
on the second change's merge commit. That is a wrong git coordinate in the
evidence. Fix: take `merge_commit_sha` from the post-merge read
(`server.ts:4025`) and use it as the target. Refuse to tag if it's missing.

**P0-3. Lists silently stop at 30 or 50 items.** Gitea's API pages at 30 by
default and caps every page at 50. I verified both on 1.27.3: `limit=100` came
back with 50, and a plain `/pulls` came back with 30 of 32. Affected:

| Call                                                                         | Where                                                | Effect                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/orgs/{org}/repos`, no limit                                                | `workspaces.ts:120`                                  | Binders past #30 vanish from the binder list, the library and quick-find            |
| `/repos/{o}/{r}/pulls`, no limit                                             | `pullRequests.ts:842`                                | Open/closed change lists, the binder's "N in review" count and Home stop at 30      |
| `/tags?limit=100`                                                            | `repos.ts:450,476`                                   | Capped at 50                                                                        |
| `/teams/{id}/members?limit=100`                                              | `orgs.ts:625`                                        | **Billable seats undercount** past 50 per team (`listBillableSeats`, `orgs.ts:831`) |
| `/orgs/{org}/members`, `/orgs/{org}/teams`, `/teams/{id}/repos` `?limit=100` | `orgs.ts:284,653,708`                                | Capped at 50                                                                        |
| drafts: branches / open pulls `?limit=100`                                   | `drafts.ts:158,177,322`, `workspaceDocuments.ts:686` | Capped at 50                                                                        |

Fix: one `listAllPages(client, path, params)` helper with `limit: 50`, a
page-until-short loop, and a hard stop. `listAllTags` already works this way.

**P0-4. Home's "decided" section can never show which version a change
published.** `loadDecidedChanges` (`server.ts:2631`) reads tags through
`listDocTags`, which only matches the pre-ADR-0004 pattern `^doc\/v\d{4}$`
(`repos.ts:258`). Nothing writes that pattern any more, so `publishedVersion`
is always null. That wastes one Gitea call per repo and gives the wrong answer.
Use `listVersionsByDocument` (or `listAllTags` and a merge-SHA lookup) and
delete `listDocTags` and `getLatestDocTag`.

### 3.2 P1: fewer Gitea calls per page

The recurring problem: **`listPullRequests` fetches every open change's
reviews** (`pullRequests.ts:850`, one or more calls per PR), and then most
callers keep only `number`. What each page costs today (O = open changes,
T = tags, B = binders):

| Page / endpoint                                            | Gitea calls today                                                                                                        | Of which unused                                                                                                                                                                                       | After P1 fixes                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Binder overview (`server.ts:4618`)                         | 2 + 1 + **O**                                                                                                            | the O reviews and the list itself: it only needs a count                                                                                                                                              | **2** (use `open_pr_counter` from the repo read, verified present) |
| Binder documents (`readBinderDocuments`, `server.ts:7298`) | 3 + **O** + ⌈T/50⌉ + O + closed pages                                                                                    | O review reads                                                                                                                                                                                        | 3 + ⌈T/50⌉ + O + closed pages                                      |
| Library / quick-find (`readLibrary`, `server.ts:2431`)     | 2 + B·(2 + **O** + ⌈T/50⌉ + O)                                                                                           | B·O review reads                                                                                                                                                                                      | 2 + B·(2 + ⌈T/50⌉ + O)                                             |
| Change detail (`server.ts:4198`)                           | ~12 + **D** version reads + R                                                                                            | D + R tag reads (tags already in hand); branch protection read **twice** (`readRequiredApprovals` + `readSignOffGate`); `/repos/{o}/{r}` read **twice** (`findWorkspaceRepo` + `readWorkspaceAccess`) | ~10                                                                |
| Document detail (`server.ts:7473`)                         | 5–8 **sequential** + O reviews + O files                                                                                 | `getPullRequestWithReviews` used only for the branch name (`server.ts:7561`, also `7209`)                                                                                                             | fewer, and parallel                                                |
| Home (`server.ts:2518`)                                    | 5 searches + per open repo (tree + ⌈T/50⌉ + 1 + O + protection) + per decided repo (legacy tags + protection + 2 per PR) | legacy tag read (P0-4)                                                                                                                                                                                | minus 1 per decided repo                                           |

For example, a library over 6 binders with 5 open changes and 100 tags each
comes to 86 Gitea calls through a 4-slot gate, and 30 of those calls fetch
reviews nobody reads.

Specific fixes, cheapest first:

1. **Add a `listOpenChangeRefs` (numbers and branches, no reviews)** and use it
   in `readBinderDocuments`, `handleWorkspaceOverview` and
   `handleWorkspaceDocumentDetail`. Fetch reviews only for the changes that
   `filterChangesTouching` keeps.
2. **Use `getPullRequestHeadBranch`** (it already exists, `pullRequests.ts:876`)
   wherever only the branch is needed (`server.ts:7209`, `7561`).
3. **Reuse `tags` in change detail.** Replace the per-document
   `listDocumentVersions` (`server.ts:4281`, `4322`) with
   `groupVersionsByDocument(tags, …)`. This also fixes P0-1 on that page.
4. **Read branch protection once per request** and derive both
   `requiredApprovals` and the sign-off gate from it. Also read `/repos/{o}/{r}`
   once and keep `permissions` on `WorkspaceSummary`.
5. **Run the document-detail steps in parallel.** `findWorkspaceRepo`, the
   change-branch lookup and `resolveOwnDraftBranch` don't depend on each other.
   Today they run one after another before the tree read even starts. The
   change page's base-tree read (`server.ts:4264`) could join the big
   `Promise.all` whenever the base is `main`.
6. **Parallelize `findClosedChanges` and `listAllTags`.** Both walk pages one
   at a time (`pullRequests.ts:798`, `workspaceDocuments.ts:751`).
   `findClosedChanges` can take up to 40 sequential pages when a document was
   last changed long ago, and that happens on every binder page load. Fetch
   pages 1–3 in parallel, or bound the search by the tag's commit date.
7. **Reactions are fetched once per comment** (`reactions.ts:71`) and
   **collaborators get one permission lookup each** (`repos.ts:217`). Both are
   N+1 with no bulk alternative in Gitea. They're fine at today's sizes; note
   them for later.

### 3.3 P2: resilience and observability

**P2-1. One user's page can stall everyone.** The gate is a single FIFO for the
whole process. A library load that makes 86 calls takes all four slots while
another user's single change-detail read waits behind it. Options, in order of
effort: (a) round-robin between sessions, so each user has their own sub-queue
and the gate takes one call from each in turn; (b) give interactive reads
priority over the long library fan-out.

**P2-2. There are no timeouts, and abandoned requests keep running.** Pass
`req.signal`, combined with `AbortSignal.timeout(…)`, into every Gitea call.
Let the gate drop a waiting task whose signal has aborted. Today a hung Gitea
socket holds one of only four slots with no deadline, and an SPA that
navigates away still pays for the page it left.

**P2-3. Count every request's Gitea usage.** An `AsyncLocalStorage` context
opened in `createApiServer` (`server.ts:10284`) can collect `giteaCalls`,
`gateWaitMs` and `giteaMs`, and add them to the existing request log line.
Expose `giteaRequestGate.inFlight` and `queued` on a debug endpoint. **Do this
first**, because it tells you whether the fixes above worked.

**P2-4. Route raw `giteaFetch` through the gate, or write down why it doesn't
go through it.** `/auth/me` runs on every app load and bypasses the gate, so
it adds unqueued load exactly when the page fan-out is busiest.

### 3.4 Security notes (not the focus of this review)

- **`/auth/me` returns the user's write-scoped Gitea token to the browser**
  (`server.ts:2184`). The SPA never reads it (a grep of `apps/` finds no use).
  CLAUDE.md's non-negotiable #1 is "Gitea tokens stay server-side". Remove
  the field. That is a one-line change that shrinks what an XSS bug could steal.
- Session rows store `gitea_token` as plaintext (`db/schema.ts:28`), and
  Litestream replicates `sessions.db` to S3. Consider encrypting that column
  with a host-held key.

## 4. On the queue idea: durable, idempotent jobs

The question behind the queue idea: **if the app goes down in the middle of an
action, does that action still finish?** Today it doesn't. Every multi-step
write runs as a chain of `await`s inside the HTTP handler. Nothing records the
intent before the first write, so a crash, a deploy or an OOM kill loses the
rest of the chain. Gitea has no cross-call transactions, so the writes that
already happened stay. Deploys make this likely rather than rare: every push
to `main` replaces the API container (`API_TAG` is pinned per commit).

### 4.1 Which actions can be left half-done

| Action                                                                      | Steps (in order)                                                                                                                                            | If the process dies partway                                                                                                                                                                             | Retry from the UI today                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publish** (`handlePublishWorkspaceChange`, `server.ts:3826`)              | compute next versions → **merge** → re-read PR for the stamp → one version tag per document, in sequence → list tags → one archive tag per removed document | **Merged with some or all version tags missing.** Documents are live on `main` with no version and no stamp. This is an evidence gap                                                                    | Refused, because the change is already merged                                                                                                                                                               |
| **Create binder** (`provisionWorkspace`, `workspaces.ts:463`)               | create repo → delete auto-init README → ensure `staff` → grant `staff` → **protect `main`** (last)                                                          | **A binder whose `main` has no branch protection.** Anyone with write can push to `main` with no approvals. Or it keeps the generated README, which lists as a document. Or it isn't granted to `staff` | **409 "already exists"** (`server.ts:9484`). The half-built binder is permanent until someone fixes it in Gitea                                                                                             |
| **Upload a new document** (`proposeBinderFileChange`, `binderFiles.ts:184`) | create `upload/<slug>/…` branch → commit → open PR                                                                                                          | Branch with a commit and no change request                                                                                                                                                              | **Refused.** `findPendingDocumentBranch` (`workspaceDocuments.ts:673`) treats the orphan branch as a pending upload at that address, so the address stays blocked                                           |
| **Add or change a binder person** (`handleBinderPerson`, `server.ts:6431`)  | ensure org membership → **remove from role teams** → create role team → grant it → add member → recompute approvals whitelist                               | Their old role is removed and the new one isn't granted, so they lose access. Or they have access but aren't on the approvals whitelist, so their approval doesn't count                                | Works (each step is set-to-state), but only if someone notices                                                                                                                                              |
| **Create organization** (`provisionSignup`, `signup-provisioning.ts:95`)    | create Gitea org → `staff` + founder → **SQLite org record** (trial clock) → claim legacy billing                                                           | Gitea org with no SQLite record, so no trial and no billing row                                                                                                                                         | Makes a **second** org. The name loop skips any name it can see (`findOrganization … continue`), and the founder can see their own orphan, so the retry lands on `name-2`. The doc comment claims otherwise |
| Propose a draft (`server.ts:8466`)                                          | open PR → delete SQLite draft row                                                                                                                           | Draft row left pointing at a proposed branch                                                                                                                                                            | Low impact                                                                                                                                                                                                  |
| Signup (`server.ts:1921`)                                                   | create Gitea user → verify → session                                                                                                                        | User exists, no session                                                                                                                                                                                 | The user can log in. Low impact                                                                                                                                                                             |

The **Stripe webhook** (`server.ts:3515`) is already built the right way, and
it's the model for everything above. It is at-least-once: Stripe retries
until it gets a 2xx. It's deduplicated: `webhookEventStore.isProcessed(event.id)`.
And it's marked done only **after** processing (`server.ts:3766`), so a crash
means a redelivery, not a lost event. The Gitea-side actions have no
equivalent of Stripe's retry, so the BFF has to supply its own.

### 4.2 What "idempotent queue" has to mean here

A queue alone doesn't fix this. SQS guarantees delivery **at least once**, so
a job that crashed after the merge will be delivered again and has to cope
with the merge having already happened. The durability comes from four
properties, and the transport is secondary:

1. **Write intent before the first irreversible write.** The handler
   validates, computes the whole plan and stores it as a job row before
   touching Gitea. For publish, the plan is the PR number, the expected head
   SHA, and per document its uid, version number, tag name and the stamp
   inputs (who approved, and when). A process that dies after that point
   leaves a row that says exactly what is left to do.
2. **Every step is check-then-act against Gitea, which is the source of
   truth.**
   - _Merge:_ if the PR is already merged, read its `merge_commit_sha` and
     continue. If it was merged at a head other than the planned one, stop
     and dead-letter.
   - _Tag:_ if `<uid>/vN` already exists **and points at the merge SHA**,
     treat it as done. If it exists and points anywhere else, that's a real
     conflict, so dead-letter it and don't overwrite. This is why P0-2 (tag
     the merge SHA, not `main`) comes first: without a fixed target, "already
     done" can't be told apart from "somebody else's tag".
   - _Repo create:_ if the repo exists, continue to the next step instead of
     returning 409.
   - _Protection, whitelist, team grants:_ these are already "set to this
     state" calls, so they are naturally idempotent.
   - _Branch plus PR:_ look for an open PR from that head before opening one.
3. **Roll forward, never back.** A saga with compensating steps (delete the
   repo, revert the merge) is the usual pattern, but here it's wrong: a merge
   and a tag are evidence, and deleting evidence to undo a half-publish is
   worse than finishing it. Every job drives toward completion. If it can't
   finish, it stops in a visible `failed` state for a human to handle.
4. **One job at a time per binder.** Two publishes in one binder race for
   version numbers today (both compute `v4` and the second gets a 409). If a
   binder's publish jobs run in order (an SQS FIFO `MessageGroupId`, or
   `WHERE repo = ? … ORDER BY id` with one runner per repo), the version
   numbers become correct by construction. Different binders still run in
   parallel.

Two more pieces round it out. An **`Idempotency-Key`** header on the mutating
endpoints, stored on the job row, makes a double-click or a browser retry get
the same job back instead of starting a second one. **Lease plus attempts plus
backoff plus a dead-letter status** means a runner holds a job for N seconds.
If it dies, the lease lapses and another pickup resumes it. After K failures
the job goes to `failed` and raises a CloudWatch alarm, because the API
already ships logs to `/bindersnap/api` through `awslogs`.

### 4.3 SQS or SQLite

**Recommendation: a job table in the API's existing SQLite database
(`sessions.db`), processed by a loop inside the API process. Keep it behind a
small interface so it can move to SQS later.**

|                            | SQLite job table (outbox)                                                                                                     | Amazon SQS (FIFO)                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Survives an API crash      | Yes. The row is committed before the first Gitea write                                                                        | Yes, **but only after** the `SendMessage` succeeds. A crash between the BFF's decision and the send loses the intent, so you'd still want a local outbox to feed SQS                         |
| Survives losing the host   | Yes, within Litestream's lag. `sessions.db` is already replicated to S3, and the API opens it in WAL mode (`db/client.ts:17`) | Yes                                                                                                                                                                                          |
| Ordering per binder        | `ORDER BY id` per repo                                                                                                        | FIFO message groups                                                                                                                                                                          |
| Deduplication              | Unique `idempotency_key` for as long as you want                                                                              | FIFO dedup only lasts **5 minutes**, so step-level idempotency is needed anyway                                                                                                              |
| Fits this deployment       | One host and one API container (ADR 0003). No new AWS resource, IAM policy or endpoint. `bun run up` works unchanged          | New Terraform resource plus IAM on the instance role. Local dev needs an emulator (ElasticMQ or LocalStack) in `docker-compose.yml`, which is one more thing the dev stack can't run without |
| Consumer                   | The API process (or a second `bun` entrypoint in the same image)                                                              | Still a process on the same host, so SQS moves the queue off the box but not the worker                                                                                                      |
| Where it stops being right | More than one API instance: move to SQS (or `SELECT … FOR UPDATE SKIP LOCKED` on Postgres)                                    | Once there are several workers or hosts                                                                                                                                                      |

With one host, SQS adds a network hop and a failure mode without adding a
guarantee the SQLite table lacks. The idempotency still has to live in the
steps either way (§4.2). The table is also the outbox SQS would need anyway.
So the table is the right first step, and it doesn't rule out SQS later.

**Does a job table break "evidence lives in Gitea"?** No, but write that down
in ADR 0004. A job row records **work still to do**, not what happened. It is
never read to answer "was this approved" or "what version is live"; Gitea
answers those. Once done, a row can be deleted without losing anything (keep
it for 30 days for debugging). The Stripe `webhook_events` table is the
existing precedent for operational state in SQLite.

### 4.4 Sketch

```ts
// services/api/jobs/  (new)
interface JobRow {
  id: string; // uuid
  kind:
    | "publish"
    | "provision-binder"
    | "grant-binder-person"
    | "propose-upload";
  groupKey: string; // "org/repo"; one runner per group
  idempotencyKey: string | null; // unique; from the request header
  plan: string; // JSON, everything needed to finish without the request
  status: "pending" | "running" | "done" | "failed";
  step: number; // last completed step (informational; steps are re-checked anyway)
  attempts: number;
  leaseUntil: number | null;
  lastError: string | null;
  createdBy: string; // username; the runner acts with the service token, not the session
}
```

- **Handler:** validate, build the plan, insert the row (return the existing
  one if the idempotency key matches), **run it inline**, then answer
  `200` with the result. A normal request is as fast as it is today. If the
  inline run fails partway, answer `202 { jobId }`, and the page shows
  "finishing publish…" and polls `GET /api/app/jobs/:id`.
- **Runner:** on startup, and then every few seconds, it claims
  `pending`/expired-lease rows and runs them. Each step is a `check → act`
  pair.
- **Credentials:** a job can't depend on a session token that may have
  expired. The runner acts with the service token, and the plan records the
  acting user for the audit fields. Because this changes who appears to
  perform a Gitea write, it's worth a sentence in ADR 0004 too. The
  alternative is to keep inline runs on the user's token and use the service
  token only for recovery.
- **Where to start:** publish, then binder provisioning. Those two are the
  compliance-relevant rows in §4.1. The other flows can move over once the
  mechanism exists.

A **reconciler** still earns a place alongside it. It's a periodic scan for
merged changes with missing version tags, and for binders without protection
on `main`. It repairs what happened before the job table existed, and
anything done outside the BFF. It reads only from Gitea, so it needs no new
state.

### 4.5 The throughput gate is a separate concern

The in-memory gate is a queue too, but it solves a different problem: it
limits how hard the BFF presses on Gitea's SQLite. It isn't why pages are
slow, and making it bigger or smaller won't make pages much faster. To do
that:

1. **Make fewer calls** (§3.2): roughly 30–50% of calls on the list pages
   fetch data nobody uses.
2. **Wait less between calls**: parallelize the sequential steps (§3.2 items
   5–6).
3. **Tune the gate against production's journal mode, not dev's** (§2, P1-1).
4. **Make the gate fair** (P2-1) and able to cancel work (P2-2).

## 5. On the cache idea

**The constraint.** AGENTS.md and ADR 0004 ban caching Gitea state. The
reason isn't style: on this product, a cached "approved" that Gitea has since
dismissed is a false statement in an audit trail. Any proposal has to fit
inside that rule, or change it by ADR. What fits, in order of safety:

1. **In-flight coalescing ("singleflight").** Concurrent callers asking for
   the same key (`GET /repos/acme/nursing/tags?page=1` as token X) share one
   pending promise. Nothing is kept after it settles, so nothing can go stale.
   This helps the library, Home and SPA double-mounts, which ask for the same
   thing at the same moment. The key must include the token, because Gitea's
   answer depends on who is asking.
2. **Per-request memoization.** Within one request, remember `findWorkspaceRepo`,
   branch protection, `listAllTags` and similar calls. That covers every
   duplicate read in §3.2 item 4 without touching the rule.
3. **Content-addressed memoization.** Some responses can never change for the
   same key: a tree at a commit SHA, a blob at a SHA, a tag's target, the files
   of a merged PR, and the tag message of an annotated tag. Caching those in a
   bounded in-memory LRU keyed by `(repo, sha)` **cannot be stale**. That is
   the same reasoning ADR 0004 uses to allow a derived index ("every row keys
   on an immutable git coordinate"). Access still has to be checked per user:
   cache the content, but keep the permission check (the cheap
   `/repos/{o}/{r}` read) on every request. **This needs a one-paragraph ADR
   note**, because the current wording bans it literally.
4. **A webhook-invalidated read cache.** Cache mutable reads (open PRs, the tag
   list, the tree at `main`) and invalidate them from Gitea webhooks (`push`,
   `pull_request`, `pull_request_review`, `create` for tags). This is the only
   option that removes the BFF→Gitea round trip for hot pages, and it is the
   only one that can serve something stale: webhooks are asynchronous, and a
   lost webhook means a stale entry until its TTL expires. If it ever gets
   built, it has to exclude everything that decides whether a change can be
   published or shows its approval state. That rule already exists: "The
   index serves browsing; Gitea serves proving". **This is a `human-needed`
   ADR decision, not an implementation task.** My recommendation: do §3.2,
   P1-1 and options 1–3 first, measure with P2-3, and only then decide whether
   option 4 is still needed.

Option 1 reduces the load on Gitea. Options 2–3 remove calls from the page's
critical path. Neither needs a new service: at this scale an in-process LRU
beats Redis, and one EC2 host with one API container doesn't need a shared
cache.

## 6. Recommended order

| #      | Change                                                                                                                                                                                                                          | Why                                                                                                  | Size         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| P0-1   | Versions from paginated tags; test with >30 tags                                                                                                                                                                                | Publish breaks after the merge                                                                       | S            |
| P0-2   | Tag `merge_commit_sha`, not `main`                                                                                                                                                                                              | Evidence points at the wrong commit under concurrent publishes                                       | S            |
| P0-3   | `listAllPages` helper; apply to repos, pulls, teams, members, drafts                                                                                                                                                            | Silent truncation, seat undercount                                                                   | M            |
| P0-4   | Drop `listDocTags`; Home uses binder tags                                                                                                                                                                                       | Wrong data plus a wasted call                                                                        | S            |
| sec    | Remove `token` from `/auth/me`                                                                                                                                                                                                  | Non-negotiable #1                                                                                    | XS           |
| P2-3   | Per-request Gitea call and gate-wait metrics                                                                                                                                                                                    | Measures everything after this                                                                       | S            |
| P1-1   | Set `GITEA__database__SQLITE_JOURNAL_MODE=WAL` in both compose files (prod is WAL only through Litestream; dev is rollback); re-run the gate benchmark on a prod-shaped host; raise `MAX_CONCURRENT_GITEA_REQUESTS` if it holds | Dev matches prod; up to 3.3× under load in dev (measured); prod no longer depends on a sidecar       | XS + measure |
| P1-2   | Review-free open-change listing; `open_pr_counter`; `getPullRequestHeadBranch`                                                                                                                                                  | 30–50% fewer calls on list pages                                                                     | S            |
| P1-3   | Per-request memo; reuse tags and protection in change detail                                                                                                                                                                    | Removes duplicate reads                                                                              | S            |
| P1-4   | Parallelize the document-detail waterfall, closed-change and tag paging                                                                                                                                                         | Shorter critical path                                                                                | S            |
| P2-1/2 | Fair gate, `AbortSignal` and timeouts                                                                                                                                                                                           | One user can't stall everyone; hung calls get a deadline                                             | M            |
| dev    | Mint a service token in the dev seed instead of basic auth                                                                                                                                                                      | Dev privileged reads ~3× cheaper; dev behaves like prod                                              | S            |
| §4     | Job table + runner; move **publish** onto it (needs P0-2), then **binder provisioning**                                                                                                                                         | A crash or deploy mid-action can no longer leave a merge without tags or a binder without protection | M            |
| §4     | Idempotent retries in the UI: binder create continues past an existing repo; upload ignores an orphan branch with no PR; org create resumes its own orphan                                                                      | Stops the "retry is refused" column in §4.1                                                          | S            |
| §4     | Reconciler for merged-without-tags and unprotected-`main` binders                                                                                                                                                               | Repairs what already happened                                                                        | S            |
| §5.1–3 | Singleflight, then SHA-keyed LRU (with an ADR note)                                                                                                                                                                             | Less Gitea load, fewer critical-path calls                                                           | M            |
| §5.4   | Webhook-invalidated cache                                                                                                                                                                                                       | Only if the above isn't enough; ADR first                                                            | L            |

## 7. What this review did not verify

- **Production latency.** All numbers are local and relative. P2-3 is how to
  get real ones.
- **The live host.** §2 comes from the committed config and the pinned
  upstream sources, not from the running machine. The one thing only the host
  can show is whether an out-of-band change overrides the committed config.
  `PRAGMA journal_mode` on `/data/gitea.db`, through the SSM path, answers
  that in a second.
- **The §4.1 crash windows** come from reading the code. I didn't kill a
  process mid-flight to reproduce them. The publish case is reproduced
  indirectly: P0-1's 409 leaves the same state a crash would.
- **Gitea 28 (the dev nightly).** Paging defaults and tag ordering were checked
  on 1.27.3, the production tag.
- **The frontend.** A browser-side cache and request deduplication (for
  example stale-while-revalidate on the SPA's `api.ts`) were out of scope as
  asked. They would add to the singleflight above, not replace it.
