# ADR 0004 — implementation status

Working notes for the series implementing
[ADR 0004](./0004-organization-workspace-folder-and-org-billing.md). Delete this
file when the series lands.

## Where the series stands

| PR                                                                     | What it did                         | State      |
| ---------------------------------------------------------------------- | ----------------------------------- | ---------- |
| [#389](https://github.com/davidgraymi/bindersnap-editor-demo/pull/389) | Verified the Gitea permission model | **merged** |
| [#390](https://github.com/davidgraymi/bindersnap-editor-demo/pull/390) | Organization and team client        | **merged** |
| [#391](https://github.com/davidgraymi/bindersnap-editor-demo/pull/391) | Org + first binder at signup        | **merged** |
| [#392](https://github.com/davidgraymi/bindersnap-editor-demo/pull/392) | Reads are never gated               | **merged** |
| [#393](https://github.com/davidgraymi/bindersnap-editor-demo/pull/393) | Bill the organization               | open       |

### Step 2 — documents as files (2026-09-04)

Six PRs, **all CI-green, none merged**, each stacked on the one above it. They
must merge bottom-up; #398 has been green longest and landing it makes every
rebase after it cheaper.

| PR                                                                     | Branch                             | What it did                                                 |
| ---------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| [#398](https://github.com/davidgraymi/bindersnap-editor-demo/pull/398) | `feat/adr4-1-workspace-api`        | A member creates a binder; the auto-created one is gone     |
| [#399](https://github.com/davidgraymi/bindersnap-editor-demo/pull/399) | `feat/adr4-2-document-write-path`  | A document is a file inside the binder                      |
| [#400](https://github.com/davidgraymi/bindersnap-editor-demo/pull/400) | `feat/adr4-3-document-read-paths`  | Reading documents out of the binder                         |
| [#401](https://github.com/davidgraymi/bindersnap-editor-demo/pull/401) | `feat/adr4-4-publish-version-tags` | Publishing versions every document a change touched         |
| [#403](https://github.com/davidgraymi/bindersnap-editor-demo/pull/403) | `feat/adr4-6-seed-binders`         | The dev seed builds an org with binders                     |
| [#404](https://github.com/davidgraymi/bindersnap-editor-demo/pull/404) | `feat/adr4-7-binder-ui`            | `/{org}`, `/{org}/{binder}`, `/{org}/{binder}/{path}` pages |

[#402](https://github.com/davidgraymi/bindersnap-editor-demo/pull/402) (the
document backfill, `feat/adr4-5-backfill-documents`) is **closed, deliberately**
— see "Decisions taken" below. The branch survives on the remote if it is ever
wanted. `feat/adr4-documents-as-files` is an earlier name for #398's commit and
holds nothing extra.

## Why #393 carries the organization-creation flow too

They cannot ship apart. The migration parks every username-keyed billing row
and rebuilds the live tables org-keyed, so an account with no organization has
nothing to key to — and until this branch, nothing created one except signup,
silently, for new accounts only. Landing the re-key alone would lock every
existing account out of authoring with no self-serve way back.

So the same change that moves billing onto the organization also gives a person
the way to have one: `POST /api/app/organizations`, a screen at
`/organizations/new` that asks them to name it, and a claim that moves any
billing parked under their username onto the organization they just created.
Signup no longer provisions one behind their back.

## The URL scheme, and why the organization is in the path

Addresses are the ones Gitea and GitHub use, because a person moving between
Bindersnap and Gitea should see the same address twice:

```
/{org}                       what this organization owns
/{org}/{binder}              the binder's documents, by folder
/{org}/{binder}/{path}       one document

GET  /api/app/binders                                   every binder I can act in
GET  /api/app/orgs/{org}/binders                        one organization's binders
POST /api/app/orgs/{org}/binders                        create one
GET  /api/app/binders/{org}/{binder}/documents          list
GET  /api/app/binders/{org}/{binder}/documents/{path}   one document
POST /api/app/binders/{org}/{binder}/documents          upload
POST /api/app/binders/{org}/{binder}/changes/{n}/publish
```

**The organization is in the path because it cannot be inferred.** The first
cut had `/api/app/workspaces/{binder}/…` and asked
`resolveSessionOrganization` which organization the caller meant — and that
function picks the oldest. A person in two organizations opening a URL for one
could be served the other's binder of the same name. Naming it removes the
guess, and authorization gets simpler rather than harder: these handlers act
with the caller's own token, so a binder they cannot see answers 404 from Gitea
without a membership check to write or keep in step.

Two listings, deliberately, because they answer different questions.
`GET /api/app/binders` is a question about a person — everything I can act in,
wherever it lives — and is what the personal views are built on.
`GET /api/app/orgs/{org}/binders` is a question about an organization. Both are
needed; collapsing them is what left the app with no organization view at all.

**Reserved first segments** make the bare `/{org}` address possible:
`activity`, `admin`, `auth`, `billing`, `docs`, `documents`, `login`,
`organizations`, `signup` (`RESERVED_FIRST_SEGMENTS`, `apps/app/routes.ts`).
Anything added there must also be refused as an organization name, or
somebody's binder becomes unreachable.

## Defects found while getting this green

Each cost a CI round or more and is worth not rediscovering. The first four are
from the billing series; the rest are from step 2.

1. **Signup could not create an organization.** Gitea answered `POST /orgs` with
   a bare 403 and a nil body — `org.Create` refusing at
   `CanCreateOrganization()`, the only 403 on that path that logs no message.
   `AllowCreateOrganization` is stamped onto a user once, at creation, from
   settings the admin API has no field for. Both compose files now state
   `DEFAULT_ALLOW_CREATE_ORGANIZATION` and `DISABLE_REGULAR_ORG_CREATION`
   rather than inheriting them, so a Gitea default that moves cannot silently
   un-provision every new account.

2. **The second customer of the same name could not sign up.** Gitea answers
   `GET /orgs/{org}` for a private organization the caller cannot see with a
   404 — identical to a free name. So asking is not enough: creation is the
   availability check, and a 422 (and only a 422) steps to the next candidate.

3. **A trialing organization could not subscribe.** `BillingPage` showed the
   manage panel whenever `subscriptionStatus === "active"`, and a trial makes
   that true with no Stripe subscription behind it — so the page offered a
   portal for a customer that does not exist and hid "Subscribe now".
   `hasManageableSubscription` (in `apps/app/components/billingAccess.ts`, kept
   separate because `BillingPage` is module-mocked in `App.test.ts`) names the
   distinction between having access and having a subscription.

4. **Two test-harness defects**, both the same shape — inner waits exceeding
   the budget containing them. Setup hooks that seed and then poll for 30s ran
   on the suite's 10s default, and `signup.pw.ts` ran a whole account lifecycle
   on it too.

5. **A new binder was not empty.** `createWorkspaceRepo` passes
   `auto_init: true`, which is how `main` comes to exist so it can be protected
   — and it writes a `README.md`. Once documents were files, the read side
   listed that README as a policy called "README". `bootstrapEmptyMainBranch`
   now strips it at provision time, before protection goes on.

6. **Merging a binder change fell into a single-document rescue.**
   `mergeOrResolveConflicts` attempts a merge only when `pr.mergeable !== false`
   and otherwise rebases and re-applies _the_ document file — valid when a
   repository holds one document, impossible in a binder. Gitea computes
   `mergeable` asynchronously, so a just-created, just-approved change commonly
   reads `false`: the merge was never attempted, and the rescue then failed with
   "Could not find document file on head branch", which is not what went wrong.
   `mergeWorkspaceChange` (`services/api/gitea-client/pullRequests.ts`) goes
   straight to the merge, retries the states Gitea describes as transient under
   either 405 or 409 ("please try again later", "does not have enough
   approvals", "is being checked"), and **keeps Gitea's own message** — the
   invented one sent three rounds of debugging after the wrong cause.

7. **Approvals are dismissed as stale, and it is a race.** A binder protects
   `main` with `dismiss_stale_approvals`, and Gitea processes a push
   asynchronously — so an approval submitted moments after a commit lands is
   recorded against the old head and then dismissed (`stale: true`,
   `dismissed: true`), leaving the merge to fail with "Does not have enough
   approvals" and no visible reason. The behaviour is correct and worth keeping.
   Tests approve in a loop until the review actually stands
   (`approveChange`, `tests/workspace-provisioning.pw.ts`); anything else
   driving a publish needs the same.

8. **Seeded role teams had no permission at all.** The seed sent Gitea `units`,
   which it ignores in favour of `units_map`, so every team came out
   `permission: none` — members of a binder who could not touch it. `orgs.ts`
   now exports `ROLE_TEAM_OPTIONS` and the seed uses the app's own definition
   rather than a second copy. Note that Gitea reports a team's own `permission`
   as `"none"` whenever its access is per-unit, and the repo _collaborator_
   endpoint answers `"none"` for team-derived access — so neither is a way to
   check a member's access. Ask the repository as that member and read
   `permissions.push`.

9. **Two documents could claim one address.** `nursing/policy.md` and
   `nursing/policy.pdf` both answered to `nursing/policy`, so a link resolved to
   whichever the tree listed first — and worse, version tags key on the same
   identity, so publishing one wrote the other's `nursing/policy/v1`. The
   identity drops the extension on purpose (re-uploading a policy as a PDF
   should keep its history), so the fix is exclusivity, not putting the
   extension back. Uploads refuse a taken address, **including one claimed by an
   unpublished change** — `main` holds only published documents, so checking the
   tree alone let two uploads race; the upload branch (`upload/<slugPath>/…`)
   carries the identity, which is what `findPendingDocumentBranch` reads.

Also added: `tests/global-teardown.ts` saves the API container log to
`test-results/api.log` before the stack goes down and prints its error lines
into the job output. Defect 1 was invisible without it, because provisioning is
best-effort and swallowed the cause.

## Verified against Gitea 1.27.3

The 1.26 → 1.27.3 upgrade (#387) landed mid-series. Provisioning passes on it
unchanged. #389's CODEOWNERS finding was a reading of 1.26 source and is being
re-checked separately on `claude/reverify-codeowners-gitea-1273`.

## Decisions taken (2026-09-03/04)

Settled with the product owner during the step-2 series. Do not reopen without
asking.

1. **No document backfill.** There are no real customers, so existing
   user-owned document repositories are abandoned rather than replayed. #402 is
   closed. ADR 0004 migration step 3 is dropped — the amendment is recorded in
   the ADR itself.
2. **The seed is the fresh start.** It builds `riverside-health` with two
   binders rather than ten user-owned repositories.
3. **No compatibility window.** With nothing to migrate, the old
   one-repo-per-document endpoints get deleted outright rather than deprecated.
4. **URL renames and redirects are deferred.** `/{org}/{binder}/{path}` is built
   on three names, any of which Gitea can rename under a link somebody already
   sent. GitHub solves this with permanent redirects. Explicitly "much later
   down the road" — do not build it, and do not open an issue for it.
5. **A binder you cannot see answers 404, not 403.** It is the same answer a
   binder that does not exist gives, which is the only one that does not
   disclose which it was.
6. **Personal views stay cross-organization; organization views are scoped.**
   "What is waiting on me" and "what do I own" span every organization a person
   belongs to. "What does this organization have" does not.

## What is left

In rough dependency order.

1. **Team management on the organization page.** Named by the product owner as
   the next thing wanted. The binder's three role teams already carry
   membership (`createWorkspaceTeams`, `grantTeamOnRepo`); the organization page
   at `/{org}` needs to surface and edit it. Nothing new in Gitea is required.
2. **Writing from the binder UI.** #404 is read-only: it browses binders and
   documents and creates a binder. Upload and publish still go through the old
   per-document screens. The API for both is done and tested — this is screens.
3. **Delete the old model.** `POST /api/app/documents`,
   `createPrivateCurrentUserRepo`, the 16 `documents/:owner/:repo` routes in
   `services/api/server.ts`, and roughly a dozen SPA files that address a
   document as `owner/repo`. Safe once (2) lands, per decision 3.
4. **The `document_versions` derived index.** Not started. The ADR's "Derived
   indexes" section is the specification. Note the binder model already made the
   list cheap — `listVersionsByDocument` reads a binder's tags once rather than
   once per document — so this is now an optimization rather than a rescue.
5. **Per-workspace settings and `settings_events`.** Not started.
   `blockOnUnresolvedThreads` still lives in the config branch.
6. **CODEOWNERS generation**, naming **people, not teams**, per #389's finding.
   Not started.
7. **Screenshots of the binder UI.** Blocked on a rebuilt API container — see
   below.

## Working on this locally — two traps

**Integration tests cannot be pointed at a locally built API.**
`tests/global-setup.ts` sets `process.env.BUN_PUBLIC_API_BASE_URL` to the proxy
in front of the `api` container, overriding anything passed in. So an API change
is only exercisable after the container is rebuilt, and until then CI is the
only loop. Running `bun services/api/server.ts` on a spare port against the
running Gitea works for hand-testing with `curl` — that is how defects 6, 7 and
9 were found — but Playwright will not use it.

Rebuilding is `bun run down && bun run up`, and `down` is
`docker compose down -v`, which deletes the volumes and every seeded account
with them. `docker compose up -d --build api` rebuilds only the API and
preserves volumes.

**The shared dev stack accumulates debris that changes behaviour.** After a run
of the integration suites it holds `bs-adr4-*` organizations that every seeded
user is a member of. `resolveSessionOrganization` picks the _oldest_
organization, so the app resolves `alice` to test debris rather than to
`riverside-health`, and the seeded binders appear to be missing. Twenty
`mercy-health-N` organizations also exhaust `MAX_NAME_ATTEMPTS`, after which any
test creating an organization called "Mercy Health" fails with a 502. A full
`down && up` clears both. The seed deliberately uses `riverside-health` so it
does not squat on the name several suites create on purpose.

## Three product decisions still unanswered

Raised in the PR bodies, none answered. They change the work.

1. **Signup funnel.** #369 says no card during the 14-day trial, which
   contradicts the old signup → `/billing` redirect. #393 lands a new account in
   its workspace instead. Keeping the card-up-front funnel would mean making
   the trial opt-in.
2. **Read-only mode for delinquent orgs.** The API rule is enforced as of #392,
   but the SPA still redirects an unpaid session to `/billing`, so no customer
   can yet exercise it. A real read-only mode — mutating controls disabled, a
   banner saying why — is its own piece of work.
3. **Do org owners cost a billable seat?** `listBillableSeats` counts any team
   with write or better on `repo.code` that is granted onto a repository, which
   includes Gitea's built-in Owners team. A pricing decision, not a naming
   accident — see #390's description.
