# Backend review: the BFF ↔ Gitea layer

_September 2026 · base: `development/binders-gitea-28` @ `a0439d8`_

The question was where the backend is weak, with two ideas to test:

1. **A queue**, because one browser request turns into two or more Gitea requests.
2. **A cache between the BFF and Gitea**, because the app loads slowly.

The short answers:

- **There is already a queue.** Every Gitea call goes through a four-slot
  process-wide gate (`gitea-client/request-gate.ts`). A second queue would not
  make a page faster: it would only reorder the same calls. What makes pages
  slow is **how many calls each page makes**, and a lot of those calls fetch
  data the page never uses. Pages also run steps one after another that could
  run in parallel, and Gitea's SQLite is still in its default rollback-journal
  mode. A queue _is_ the right tool in one place: the **publish write path**,
  where a merge and its version tags are separate writes that can half-fail
  (§5).
- **A general cache in front of Gitea is banned by this repo's own rules**, and
  on a compliance product that rule is correct (AGENTS.md: "Anything else that
  duplicates Gitea state is a cache, and caches are still banned."). Three
  cache-like techniques are allowed because none of them can show stale data:
  sharing one in-flight request between callers, memoizing within a single
  request, and caching data keyed by a git object that can never change. Those
  get most of the benefit. A webhook-invalidated read cache is possible, but it
  needs an ADR change first (§6).
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
- Gitea defaults to `journal_mode=delete`. I checked this with `PRAGMA
journal_mode` on a fresh install. Neither compose file sets
  `GITEA__database__SQLITE_JOURNAL_MODE`.
- **Basic auth costs about 3× a token call** (23 ms vs 7 ms per request,
  sequential), because Gitea hashes the password on every request. This only
  affects dev, but dev is where the gate limit was tuned and where "the app
  loads slowly" is usually noticed.

Production probably already runs Gitea's DB in WAL, because Litestream switches
the database it replicates to WAL and that setting sticks in the file. But
nothing in this repo requires it, dev does not have it, and **the gate limit
of 4 was measured on dev**, so it is probably too low for production. See
P1-1.

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
  The change ends up merged with no version tag. There's no retry and no
  reconciler, so the evidence record now has a gap.
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

## 4. On the queue idea

"One browser request becomes several Gitea requests" is true, but a queue
doesn't change that. The existing gate already is a queue, and it is doing
its job: keeping Gitea's SQLite from piling up writers. Adding another queue
in front of it only moves the waiting to a different place. To make pages
faster:

1. **Make fewer calls** (§3.2): roughly 30–50% of calls on the list pages
   fetch data nobody uses.
2. **Wait less between calls**: parallelize the sequential steps (§3.2 items
   5–6).
3. **Make each call cheaper and raise the gate limit**: turn on WAL
   explicitly, re-measure, and raise the limit if the numbers support it (P1-1
   below).
4. **Make the queue fair** (P2-1) and able to cancel work (P2-2).

## 5. Where a queue does belong: publishing

Publishing is **a merge followed by N tag writes**
(`server.ts:4007–4119`). These are separate, non-atomic Gitea writes. P0-1
shows the tag step can fail after the merge has succeeded, and nothing ever
finishes the job. That is the textbook case for durable, retryable work:

- **Reconciler (preferred, no new state).** A periodic job finds merged
  changes whose merge commit has no `<uid>/vN` tag for a file it changed, and
  writes the missing tags. It can be rebuilt entirely from Gitea, so it fits
  ADR 0004's derived-index rule without new tables. The publish handler keeps
  tagging inline, and the reconciler repairs whatever slips through.
- **Outbox (if tag writes should move off the request path).** Keep a
  `publish_jobs` SQLite row `{org, repo, pull, merge_sha, attempts, status}`
  and run a worker loop with retry and backoff. Every tag name is
  deterministic, and git refuses a duplicate ref, so a retry is idempotent by
  construction. This row is operational state, not evidence: it records work
  still to do and says nothing about what happened.

Either option needs P0-2 (tag the merge SHA, not `main`). Otherwise a retry
would tag whatever `main` points to at retry time.

## 6. On the cache idea

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

## 7. Recommended order

| #      | Change                                                                                                                                                           | Why                                                            | Size         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| P0-1   | Versions from paginated tags; test with >30 tags                                                                                                                 | Publish breaks after the merge                                 | S            |
| P0-2   | Tag `merge_commit_sha`, not `main`                                                                                                                               | Evidence points at the wrong commit under concurrent publishes | S            |
| P0-3   | `listAllPages` helper; apply to repos, pulls, teams, members, drafts                                                                                             | Silent truncation, seat undercount                             | M            |
| P0-4   | Drop `listDocTags`; Home uses binder tags                                                                                                                        | Wrong data plus a wasted call                                  | S            |
| sec    | Remove `token` from `/auth/me`                                                                                                                                   | Non-negotiable #1                                              | XS           |
| P2-3   | Per-request Gitea call and gate-wait metrics                                                                                                                     | Measures everything after this                                 | S            |
| P1-1   | `GITEA__database__SQLITE_JOURNAL_MODE=WAL` in both compose files; re-run the gate benchmark in prod-like mode; raise `MAX_CONCURRENT_GITEA_REQUESTS` if it holds | Up to 3.3× under load (measured)                               | XS + measure |
| P1-2   | Review-free open-change listing; `open_pr_counter`; `getPullRequestHeadBranch`                                                                                   | 30–50% fewer calls on list pages                               | S            |
| P1-3   | Per-request memo; reuse tags and protection in change detail                                                                                                     | Removes duplicate reads                                        | S            |
| P1-4   | Parallelize the document-detail waterfall, closed-change and tag paging                                                                                          | Shorter critical path                                          | S            |
| P2-1/2 | Fair gate, `AbortSignal` and timeouts                                                                                                                            | One user can't stall everyone; hung calls get a deadline       | M            |
| dev    | Mint a service token in the dev seed instead of basic auth                                                                                                       | Dev privileged reads ~3× cheaper; dev behaves like prod        | S            |
| §5     | Publish reconciler (then an outbox, if wanted)                                                                                                                   | Half-finished publishes get repaired                           | M            |
| §6.1–3 | Singleflight, then SHA-keyed LRU (with an ADR note)                                                                                                              | Less Gitea load, fewer critical-path calls                     | M            |
| §6.4   | Webhook-invalidated cache                                                                                                                                        | Only if the above isn't enough; ADR first                      | L            |

## 8. What this review did not verify

- **Production latency.** All numbers are local and relative. P2-3 is how to
  get real ones.
- **Whether production's `gitea.db` is actually in WAL right now.** Check with
  `sqlite3 /data/gitea.db 'PRAGMA journal_mode'` on the host (through the
  break-glass SSM path), then set it explicitly regardless.
- **Gitea 28 (the dev nightly).** Paging defaults and tag ordering were checked
  on 1.27.3, the production tag.
- **The frontend.** A browser-side cache and request deduplication (for
  example stale-while-revalidate on the SPA's `api.ts`) were out of scope as
  asked. They would add to the singleflight above, not replace it.
