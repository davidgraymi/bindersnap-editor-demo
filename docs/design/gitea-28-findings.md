# Gitea 28.0.0 — what changes for ADR 0004, verified at source

Verified 2026-09-04 against the `go-gitea/gitea` repository and Docker Hub. This
file is evidence, not design: every claim below names the source that proves it,
so the design documents beside it can rest on the claims rather than re-argue
them. Where something is _not_ verified against a running Gitea, it says so.

Read with `docs/adr/0004-organization-workspace-folder-and-org-billing.md`,
"Verified Against Gitea" — this file amends two of that section's conclusions
and confirms a third.

## 1. The next Gitea is 28.0.0, and there is no `1.28-dev` image

Gitea dropped the `1.` prefix. The next major is **28.0.0**; there is no 1.28 and
never will be, so a `gitea/gitea:1.28-dev` tag cannot be pulled because it does
not exist. Nor does a `28`-prefixed tag yet.

| Fact                            | Value                                                  |
| ------------------------------- | ------------------------------------------------------ |
| Latest release                  | `1.27.3`, 2026-08-29 — what the stack runs today       |
| Next major milestone            | `28.0.0`, **open**: 402 closed, 10 open                |
| That milestone's due date       | **2026-08-28** — already a week overdue                |
| Only image carrying 28.0.0 code | `gitea/gitea:main-nightly` (rebuilt daily)             |
| The `*-dev` tags on Docker Hub  | Stale since 2023. Not a channel. Do not reach for them |

The practical reading: 28.0.0 is _close_, not distant — a milestone that is 97%
closed and past its due date is in endgame, and 1.27.0 went from `rc0`
(2026-06-29) to release (2026-07-13) in a fortnight. The upgrade decision is
therefore about **weeks**, not quarters, which is what makes waiting for an `rc`
tag a live option rather than a stall.

## 2. `block_on_codeowner_reviews` — CODEOWNERS becomes enforcement

**go-gitea PR #34995, "feat: Add block on pending codeowner reviews branch
protection", merged 2026-07-31 into milestone 28.0.0.** It closes go-gitea issue
#32602, "Code Owners feature not enforceable" — the exact gap ADR 0004 worked
around.

What it adds, read from the merged diff:

- A branch-protection field **`block_on_codeowner_reviews`** on `BranchProtection`,
  `CreateBranchProtectionOption` and `EditBranchProtectionOption`
  (`modules/structs/repo_branch.go`), backed by column `BlockOnCodeownerReviews`
  (`models/git/protected_branch.go`) and migration `v1_28/v345.go`.
- A new check, `HasAllRequiredCodeownerReviews`, called from
  `CheckPullBranchProtections` in `services/pull/merge.go` — the function **every**
  merge path runs, not only the web UI's merge box.
- **Per-rule semantics.** For every CODEOWNERS rule that matches a changed file, at
  least one of _that rule's_ owners must have submitted an approving review. It is
  not one approval overall. A change touching nursing and HR needs an approval from
  each.

### The three details that decide the design

**Teams work now.** `rule.Teams` are expanded with `LoadMembers`, and any member's
approval satisfies that rule. This **retires ADR 0004's "name people, not teams"
constraint** — but only for this gate. See §3, which is the catch.

**Officialness is deliberately ignored.** The lookup passes `OfficialOnly: false`,
with a comment saying so in as many words: a code owner's approval satisfies this
gate even when it would not count toward `required_approvals` — the owner lacking
write access, or not being on the approvals whitelist. So the free-reviewer tier
works under this gate **without** `enable_approvals_whitelist`. It is still needed
for `required_approvals`, which resolves officialness the old way. Two gates, two
rules; a design that conflates them will be wrong in one of them.

**It fails closed.** An oversized or unreadable CODEOWNERS blocks the merge rather
than being treated as "no owners", and rule matching truncated by the match-time
budget blocks it too. That is the right direction for an approval control, and it
means a malformed generated file stops publishing rather than silently disabling
the control — the opposite of the `parseReviewSettings` failure mode ADR 0004
complains about.

Three smaller mechanics worth knowing:

- A rule whose only owners are the change's author is **waived**, not left
  permanently unmergeable. An author cannot approve their own change, so a rule
  naming only them can never be satisfied.
- `ignore_stale_approvals` is honoured: stale approvals are dropped before the gate
  is evaluated.
- CODEOWNERS is now read from **`pr.BaseBranch`**, where 1.27 read the repository's
  default branch. For a binder those are the same branch, so nothing changes for us
  — but it is the sort of thing that quietly changes behaviour for anyone who ever
  targets a change at something other than `main`.

Unchanged and still true: patterns are **anchored regexes**, not gitignore globs
(`policies/nursing/.*`, never `policies/nursing/`), forks are skipped, and the
notifier that _requests_ code-owner reviews still returns early for a draft.

## 3. The team-review-request bug is NOT fixed, and that is the catch

ADR 0004 records that Gitea writes a team review request and then clears its own
`official` flag. Read on `main` today (28.0.0-dev), `AddTeamReviewRequest` in
`models/issues/review.go` still does exactly that: it creates the review with
`Official: official` and then runs

```
UPDATE `review` SET official=? WHERE issue_id=? AND reviewer_team_id=?
```

with `false` — matching the row it has just written.

So on 28.0.0 a **team review request is still never official**, and
`block_on_official_review_requests` still blocks on nothing when the code owner is
a team. The reason teams work at all is that the new gate does not consult
officialness.

**The consequence, stated so nobody trips on it:** moving CODEOWNERS from people to
teams is safe **only if the binder's gate is `block_on_codeowner_reviews`**. A
binder still relying on `block_on_official_review_requests` for its per-folder rule
gets teams that assign and enforce nothing — which is the decorative-reviewer
failure ADR 0004 already caught once. The two changes are one change.

`tests/gitea-permission-model.pw.ts` already pins both halves of the old behaviour.
It should gain a third case: a team code owner under `block_on_codeowner_reviews`
blocks the merge, and a member's approval releases it.

**This bug is also the best upstream contribution available to us**, and it is two
lines: `AddReviewRequest` clears the flag _before_ inserting, `AddTeamReviewRequest`
inserts and then clears — same intent, one ordering. Fixing it would make per-folder
sign-off work on the 1.27.3 we run in production today, rather than putting a hard
floor of 28.0.0 under it.
[`org-access-architecture.md` §11.1](./org-access-architecture.md) is the proposal.

## 4. There is no organization invitation API

Not a 28.0.0 change — a standing fact, and it is the gap under "how do we add
people". Read from the `1.27.3` swagger the client is generated from:

| Path                             | Methods                |
| -------------------------------- | ---------------------- |
| `/orgs/{org}/members`            | `GET` only             |
| `/orgs/{org}/members/{username}` | `GET`, `DELETE`        |
| `/teams/{id}/members/{username}` | `GET`, `PUT`, `DELETE` |

There is **no `POST /orgs/{org}/members`**. The only way a person joins an
organization is `PUT /teams/{id}/members/{username}` — adding them to a team adds
them to the org — and that requires the account to already exist. Gitea has no
invite-by-email primitive at all.

So **inviting a colleague is a Bindersnap flow, not a Gitea one**: a pending
invitation is state Gitea cannot hold, which makes it configuration, which makes it
a SQLite table under ADR 0004's own decision procedure. That is a real addition to
the ADR rather than an implementation detail, and it is the single largest missing
piece behind "add and remove people".

Removal is native: `DELETE /orgs/{org}/members/{username}`.

## 5. Reading a member's access: the endpoint that looks right and is not

`GET /repos/{owner}/{repo}/collaborators/{collaborator}/permission` exists and
looks like the answer to "what can this person do in this binder". It is not.

It returns `permission.AccessMode` from `GetIndividualUserRepoPermission`
(`models/perm/access/repo_permission.go`). Team access granted **per unit** — which
is exactly how `<ws>-authors` and `<ws>-reviewers` are defined — lands in
`perm.unitsMode`, a field that endpoint never reads. `AccessMode` stays whatever
the flat access table said, which for a private org repo reached only through a
per-unit team is `none`. An owner-team member short-circuits to `owner`.

This is the same trap as defect 8 in the implementation status, one layer down, and
it generalizes: **no per-user endpoint answers this correctly.** The read model that
does is two calls per binder — `GET /repos/{owner}/{repo}/teams`, then
`GET /teams/{id}/members` for each — which is a handful of calls for the whole
membership list rather than one per member.

`GET /users/{username}/orgs/{org}/permissions` **is** reliable, at the org level
only: it answers `is_owner`, `is_admin`, `can_write`, `can_read`,
`can_create_repository`. That is the right call for "may this person manage the
organization", and therefore for the billing guard.

## 6. What this file does not verify

Everything above is read from source, the merged diff, the generated swagger, or
the registry. None of it has been exercised against a running Gitea 28.0.0. Before
any of it is depended on:

- Stand a `main-nightly` container up and assert `block_on_codeowner_reviews`
  round-trips through `POST`/`PATCH /repos/{owner}/{repo}/branch_protections`
  and appears in the `GET`.
- Assert the per-rule gate: two folders, two owner teams, one change touching both,
  one approval — merge still blocked; second approval — merge released.
- Assert the fail-closed path with a deliberately malformed CODEOWNERS.
- Assert the author-only-rule waiver, because it is the one branch that _loosens_
  the gate and a mistake there is silent.
- Re-run `tests/gitea-permission-model.pw.ts` unchanged, to catch anything the
  major version moved underneath us.

Until those pass, treat 28.0.0's behaviour as designed-for, not relied-on.

## 7. Where the version is pinned, and the one-way door

The image is pinned in exactly two places, and they must move together:

- `docker-compose.yml:25` — the dev stack
- `deploy/files/docker-compose.prod.yml:22` — production

Both say `gitea/gitea:1.27.3` today.

The risk that makes this more than a tag bump: `deploy/files/litestream.yml`
replicates `/data/gitea/gitea.db`. Gitea runs its schema migrations on start, and
28.0.0's include `v1_28/v345.go`. **A migration is a one-way door** — Gitea has no
downgrade path, so once a nightly has migrated the production database, rolling
back to `1.27.3` means restoring from a Litestream point in time _before_ the
start, and losing everything written since. Litestream will have faithfully
replicated the migrated schema, which is the correct behaviour and no help at all.

**Only one breaking change is flagged across the whole milestone.** Scanning the
402 merged PRs for the conventional `!:` marker turns up exactly one —
`feat(actions)!: add RUN_RETENTION_DAYS to delete old action runs` — and neither
compose file enables Gitea Actions, so it does not touch us. That is a reassuring
signal rather than a clearance: the marker is a convention, not a guarantee, and
the upgrade task still owes a read of the release notes when they appear.

That asymmetry is the whole argument for taking 28.0.0 in dev first, on a stack
whose database is disposable (`bun run down` deletes the volumes anyway), and for
production waiting on a released tag rather than a nightly.

**Decided 2026-09-04: dev takes a nightly, digest-pinned; production waits for a
released tag.** Digest-pinned matters as much as the decision — `main-nightly` is a
moving tag, so pinning the tag pins nothing, and two developers on "the same"
nightly would be on different Gitea builds with different migration state. Pin
`gitea/gitea@sha256:…` in `docker-compose.yml`, leave
`deploy/files/docker-compose.prod.yml` on `1.27.3`, and note in the compose file
why the two disagree — an unexplained version skew between dev and production is a
thing somebody eventually "fixes".

## Sources

- go-gitea/gitea PR #34995 (merged 2026-07-31, milestone 28.0.0) and its diff of
  `services/issue/pull.go`, `services/pull/merge.go`,
  `models/git/protected_branch.go`, `modules/structs/repo_branch.go`
- go-gitea/gitea issue #32602, "Code Owners feature not enforceable"
- `models/issues/review.go` on `main`, function `AddTeamReviewRequest`
- `models/perm/access/repo_permission.go` on `main`,
  `GetIndividualUserRepoPermission`; `routers/api/v1/repo/collaborators.go`,
  `GetRepoPermissions`
- go-gitea/gitea milestone list and release list
- `services/api/gitea-client/spec/swagger2.json` (Gitea 1.27.3), the org, team and
  collaborator paths
- Docker Hub `gitea/gitea` tag listing
