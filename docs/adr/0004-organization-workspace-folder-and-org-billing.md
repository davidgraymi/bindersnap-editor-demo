# ADR 0004: Organization, Workspace, Folder — and Billing the Organization

Status: Accepted (design; supersedes TECHNICAL_VISION Q6)  
Date: 2026-08-31  
Related: [#370](https://github.com/davidgraymi/bindersnap-editor-demo/issues/370) (this ADR),
[#369](https://github.com/davidgraymi/bindersnap-editor-demo/issues/369) (repricing),
[#365](https://github.com/davidgraymi/bindersnap-editor-demo/issues/365) (grouping),
[#366](https://github.com/davidgraymi/bindersnap-editor-demo/issues/366) (database),
[#371](https://github.com/davidgraymi/bindersnap-editor-demo/issues/371) (departments),
[#209](https://github.com/davidgraymi/bindersnap-editor-demo/issues/209) (organizations)  
Amends: the "All data lives in Gitea. No secondary database." rule in `AGENTS.md`,
which the shipped Stripe tables already contradict. ADR 0001 remains law for the
file vault workflow; ADR 0003 remains law for deployment.

## Why This Exists

Today a document is a Gitea repository owned by **the individual who created
it** (`createPrivateCurrentUserRepo`, `services/api/gitea-client/repos.ts`), and
sharing means adding per-repo collaborators one at a time. Five things break off
that one fact:

1. **Billing has nothing to bill.** `subscriptions.username` is a primary key on
   a person (`services/api/db/schema.ts`).
2. **Access does not scale.** A compliance officer joins 200 policies one call
   at a time.
3. **Nothing is shared.** No org-wide policy default, reviewer pool, activity
   view, or audit export.
4. **Ownership is a person.** When the creator leaves, the customer's compliance
   record leaves with them. In healthcare that is disqualifying.
5. **No department dimension.** Nothing to attach a department to (#371).

`TECHNICAL_VISION.md` Q6 claims "one Gitea repository per workspace, documents
are `.json` files inside it." That is not what shipped, and it is not what should
ship: per-document branch protection and per-document approval rules are the
product, and a repo is the smallest unit Gitea can protect. **Q6 is reversed
below.**

## Decision

**Three containers, each with exactly one job, at a fixed depth.**

| Container        | Backed by                           | Its one job                             |
| ---------------- | ----------------------------------- | --------------------------------------- |
| **Organization** | A Gitea organization                | Who we bill, and who your people are    |
| **Workspace**    | A set of Gitea teams in that org    | What rules apply, and who can act       |
| **Folder**       | A row in the API's SQLite database  | How you find things                     |
| Document         | A Gitea repository owned by the org | The record itself (ADR 0001, unchanged) |

The rule a customer can hold in their head:

> **If you need different rules or different people, make a workspace. If you
> just need to find things, make a folder.**

### 1. The organization is a Gitea organization, and it owns everything

One organization per customer. Every document repo is owned by the org, not by a
person. Every human who touches Bindersnap for that customer is a member of that
one org. Signup creates the org — there is no "personal mode" that later has to
be upgraded, because that upgrade is the migration we are paying for right now.

This is what fixes ownership: removing a person removes a member, never a
document.

### 2. A workspace is a set of Gitea teams, not a second Gitea org

The obvious reading of #370 is workspace = Gitea org. We are not doing that, for
three reasons:

- **Identity would fragment.** A customer with four workspaces would manage four
  membership lists — the exact "add them to every document" problem, moved up one
  layer instead of solved.
- **Org names are a global namespace.** Gitea orgs and users share one. The first
  customer to want `compliance` takes it from everyone. Workspace-as-org forces
  `acme-compliance`-style prefixing, which is GitLab path nesting done with string
  concatenation — and renaming the company then renames every workspace, breaking
  every URL and every git remote.
- **Teams already are the primitive.** A Gitea team has members, per-unit
  permissions (`repo.code`, `repo.pulls`, `repo.issues`), and an explicit repo
  list. That is a workspace.

A workspace is three teams sharing one repo set:

| Team             | Units                                       | Who              |
| ---------------- | ------------------------------------------- | ---------------- |
| `<ws>-admins`    | `code:admin`, `pulls:admin`, `issues:admin` | Workspace owners |
| `<ws>-authors`   | `code:write`, `pulls:write`, `issues:write` | Paid seats       |
| `<ws>-reviewers` | `code:read`, `pulls:write`, `issues:write`  | **Free** (#369)  |

Reviewers can open, comment on, approve, and reject a change; they cannot push a
version or merge. That distinction is a Gitea permission, not an app-side check,
which is what makes "reviewers are free forever" safe to promise.

Membership in a workspace is `PUT /teams/{id}/members/{username}`. A document
enters a workspace with `PUT /teams/{id}/repos/{org}/{repo}`. Nothing about
either is stored outside Gitea.

**The bookkeeping cost, stated plainly:** the three role teams must hold the same
repo set, and Gitea will not enforce that. One code path attaches a repo to all
three teams of its workspace, a reconciler detects drift, and an integration test
covers the case where a document is visible to authors but not reviewers. This is
the price of using teams instead of orgs, and it is smaller than the price of
fragmenting identity.

### 3. Folders carry no permissions, and nest freely because of it

#365 asks whether a folder should optionally govern rules. It should not — because
the container that governs rules already exists and is called a workspace, and
workspaces are cheap now that identity is org-level.

So: **policy resolves through exactly two levels — workspace default, then
document override.** A folder is a label for browsing. It can nest as deep as a
customer wants precisely because nothing inherits through it: there is no
inheritance to reason about, and "who could approve this policy on this date" is
answerable by naming two teams, not by walking a tree.

### 4. On GitLab's groups-and-subgroups model

It is a good model, and it is the wrong one here:

- **Gitea has no nesting primitive.** Orgs do not nest and teams do not nest. We
  would build the tree ourselves in app state — which is #366's direction, a much
  larger decision that deserves its own argument rather than arriving as a side
  effect of this one.
- **Recursive inheritance is expensive to explain.** In an audit, "who was
  permitted to approve this, on this date" has to be defensible on one page. Fixed
  depth makes that answer enumerable. A tree makes it a computation.
- **The ICP is a non-technical compliance manager.** Arbitrary-depth group
  modelling is loved by people who model systems for a living.
- **The hierarchy healthcare actually has is attribution, not access.** System →
  hospital → department → unit mostly answers "who does this apply to and who has
  read it" (#371), not "who may merge." Departments are an attribute, handled in
  #371. Do not make them a permission level.

What we keep from GitLab: one identity boundary at the top, containers that are
cheap to create, and depth where it is free (folders). What we decline: inherited
permissions.

**The accepted cost.** A holding company with two legal entities wanting two
invoices must run two organizations, and therefore two membership lists. That is
rare, late-stage, and arguably correct — separate legal entities want separate
contracts anyway. Nothing here precludes a future billing-only "account" object
above the org, because the org is keyed by id and the Stripe linkage is already a
separate row.

## Billing

### The organization is the billing entity, and the second workspace is free

One Stripe customer per organization. **Workspaces are never metered, and neither
are documents.** Pricing the structural primitive would push a customer to cram
everything into one workspace to save money — defeating the structure we just
built, and repeating at the container level the mistake #369 identifies at the
person level.

> Price the value — people authoring governed policy. Never price the containers,
> and never price the record.

**The billable seat is a distinct human in any `-admins` or `-authors` team,
anywhere in the org.** Counted once no matter how many workspaces they author in;
highest right wins if they are an author in one workspace and a reviewer in
another. Reviewers are free and are not seats.

The seat count is therefore **derived from Gitea team membership**, not stored.
There is no seat table, nothing to drift, and the nightly reconcile
(`services/api/stripe/reconcile.ts`) is a recompute rather than a repair.

Shape to hand to #369: an org-level plan with a base price including a band of
authors, plus per-author overage — one predictable line item for procurement,
annual and invoiced for design partners, with the existing `admin_grant` override
as the comp mechanism.

### Key on the Gitea org id, not its name

`subscriptions` is re-keyed from `username TEXT PRIMARY KEY` to
`gitea_org_id INTEGER PRIMARY KEY`, with the org name denormalized for display
only. Gitea can rename both users and orgs (`POST /orgs/{org}/rename`); the
current username key silently breaks on rename today. The same change applies to
`subscription_access_overrides`.

### Trial and access precedence

`resolveAccess` gains one layer. Precedence, highest first:

1. `admin_revoke` — no access.
2. `admin_grant` — access.
3. Stripe status `active` / `trialing` (with the existing 3-day grace on a stale
   `current_period_end`).
4. Local trial: `organizations.trial_ends_at` in the future.
5. Otherwise, no access.

The 14-day trial (#369) is a local column rather than a Stripe trialing
subscription. #369 wants no card at all during the trial; creating a Stripe
customer and subscription per signup to represent that would put junk in Stripe
for every tire-kicker and make a product decision depend on a payment object. The
tradeoff — two sources of access truth — is contained by the single precedence
list above, which is one function.

### Reading the record is never gated

Structural, not a nicety: **the paywall gates authoring and mutation. It never
gates reading or exporting.** When an org has no access, mutations are blocked for
everyone in it, including reviewers — the org is delinquent, not the person. Reads
and exports stay open regardless, forever. Holding a customer's approval history
hostage is the one act that would poison a compliance reference permanently.

That is also a cleaner rule than #369's proposed route-by-route audit: gate by
intent, and let a test assert that no `GET` under `/api/app/documents` calls
`requireSubscription`.

### Who can change billing

Gitea org owners, and nobody else — read from the org's Owners team, not from an
app-side role table. If the last owner leaves, that is an ops path; the admin
override already exists.

## What State Lives Where

`AGENTS.md` says Gitea is the only datastore with sessions as the sole exception.
That has not been true since Stripe landed: `subscriptions`,
`subscription_access_overrides`, `processed_webhook_events`, and
`webhook_customer_state` are all SQLite. Rather than widen an exception one
feature at a time, this section replaces the rule with a decision procedure.

### The three questions, in order

**1. Does Gitea model this natively?** Branch protection, org membership, teams
and their unit permissions, PR reviews, assignees, review requests, comment
reactions, repo topics. If yes, **use the Gitea primitive and never shadow it.**
Gitea keeps these in its own database and enforces them at merge time. A copy of
a Gitea-enforced fact in our storage is a bug waiting for the two to disagree —
and when they disagree, the one that matters is the one Gitea enforced.

**2. Is this evidence?** Evidence is a fact about _what happened_ that a surveyor
could ask us to prove after the fact, where "our database says so" is not an
acceptable answer. Documents, versions, who approved, when, what they said, what
changed. **Evidence is a git object in the document's own repository** — a
commit, a pull request, a review, a comment, a tag. This never moves. Not to
SQLite, not to Postgres, not as an optimization.

**3. Everything else is configuration.** How the app should behave right now:
workspace display names, folder trees, department lists, review cadence,
notification preferences, billing. **Configuration is a typed, indexed, migrated
table in SQLite.** Not a file in a git repository.

### Why configuration does not belong in a git repo

The existing per-document policy file (`.bindersnap/config.json` on a
`bindersnap-config` branch, `reviewSettings.ts`) is the pattern this ADR was
originally going to extend upward to the workspace. On inspection it should not
be extended, and it should eventually be retired. Git is superb at one thing that
no database gives us for free, and that one thing is not what this file is doing.

**What git uniquely provides:** content-addressed, tamper-evident history that
travels with a clone, and a point-in-time read of any file _as of any commit or
tag_ — `GET contents?ref=v3.2`. That last property is the whole reason to accept
git's costs.

**What git costs, concretely, in this codebase:**

| Cost                               | Detail                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every read is a network round trip | No local index. `getReviewSettings` is one HTTP call, and the no-cache rule means it is one call _every time_.                                          |
| Every write is 2–4 calls           | Read for the SHA, create the config branch on first write, then PUT. Plus a commit, tree and blob object that live forever.                             |
| No cross-object query              | "Which policies are due for review this month" is not a query. It is N HTTP calls, one per document, on every page load.                                |
| No transaction across files        | Compare-and-swap per file is the ceiling. Two documents cannot be changed atomically.                                                                   |
| No types, no constraints           | A malformed file must degrade rather than fail — and in our code it degrades **silently to the permissive policy**. A corrupt byte turns off a control. |
| Monotonic growth                   | Nothing is ever deleted. Fine for a checkbox toggled twice a year; not fine for anything with write volume.                                             |

**And the file does not even buy the one thing git is for.** `bindersnap-config`
is branched off `main` once and then diverges; the document's version commits
never land on it. So there is no ref at which you can read "the policy as of
version 3.2." The design pays every cost above and receives a change log — which
an append-only table would also give us, indexed, in one query.

This is the direct answer to "Gitea keeps its settings in a database, so do
ours need to be in a repo?" **No.** Gitea is right. Settings are configuration,
configuration is queried, and git cannot query.

### When configuration shapes evidence, stamp it onto the event

The real requirement behind the config file is legitimate: a surveyor may ask
"was this approval obtained under a rule that required resolved threads?" The
answer to that is not to version the configuration. It is:

> **Git stores what happened. The database stores how the app is configured. When
> configuration shapes what happened, do not version the configuration — stamp it
> onto the event.**

At publish time, the effective policy is written into the publish record itself —
the annotated tag and the merge commit message carry the approvals required, the
approvers, and whether thread resolution was enforced. That is better evidence
than a versioned config file in every way that matters: it is immutable, it is
attached to the exact event, it needs no join against historical settings, and it
survives being handed to an auditor as a git log with no application running.

A settings _change_ is still worth recording — who turned off the thread
requirement, and when. That is an append-only `settings_events` table. It is
telemetry about administration, not evidence about a document, and it does not
need git.

### The third category: derived indexes

The documents list already fans out to roughly three Gitea calls per repository
(`getLatestDocTag`, `listPullRequestsWithReviews`, `readRequiredApprovals`). At
200 policies that is 600 calls per page load, and the review-cycle due queue
(#373) and department completion reporting (#371) both want questions that fan
out the same way. The no-cache rule cannot survive that, and it should not have
to.

A **derived index** is permitted, under three conditions that make it not a
second source of truth:

1. It is **rebuildable from Gitea from scratch**, at any time, by a job that
   takes no input but Gitea.
2. **No request handler writes to it as its primary action.** It is populated by
   webhook and by reconcile, never as the authoritative result of a user action.
3. **Dropping it loses nothing but speed.** If the answer would differ from
   Gitea, Gitea wins, and the reconciler is the bug report.

That is what "no cache" was protecting against — a cache that becomes the truth —
and these three conditions are the protection, stated so the rule can be followed
instead of worked around.

### The table

| Fact                                                      | Where                                            | Why                                     |
| --------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Organization identity, membership                         | Gitea org                                        | Native primitive                        |
| Workspace roles and permissions                           | Gitea teams                                      | Native, and Gitea enforces it           |
| Which documents are in a workspace                        | Gitea team↔repo attachment                       | Native                                  |
| Required approvals, stale-approval dismissal              | Gitea branch protection                          | Native, enforced at merge               |
| Document, versions, approvals, reviews, threads, tags     | Gitea repo and PR objects                        | Evidence (ADR 0001)                     |
| The policy in force at a publish                          | Stamped into the tag and merge commit            | Evidence, self-contained                |
| Workspace names, folder tree, departments, review cadence | SQLite                                           | Configuration; queried across documents |
| Per-document review policy                                | SQLite (migrating off `.bindersnap/config.json`) | Configuration                           |
| Settings change history                                   | SQLite, append-only                              | Administrative telemetry                |
| Stripe customer, subscription, trial, overrides           | SQLite                                           | Commercial                              |
| List/queue read models                                    | SQLite, derived                                  | Speed only; rebuildable                 |

### What this costs, honestly

Losing the SQLite file now costs more than it did: sessions, billing, workspace
names, folder trees, and policy settings. It still costs **no evidence** — not one
document, version, approval, comment, review, membership or permission. Policies
would revert to defaults and admins would re-set them; nothing a customer could be
asked to produce in an audit is gone. That asymmetry is the whole justification
for the split, and it is why the durability answer is Litestream (ADR 0003) plus
the staleness alarm in #221 rather than storing configuration in git to avoid
trusting a database we already trust with sessions and money.

**The tripwire, and it is the one that matters.** This is the direction #366 asks
about, and it stops here. Configuration and derived indexes may live in SQLite.
**Evidence may not.** Any proposal to move a document, a version, an approval, a
review, a comment, a membership or a permission out of Gitea is a new ADR
arguing that on its own merits — not a patch, and not a performance fix.

## Migration

Production data is minimal today. This is the cheapest this migration will ever
be, and every month of delay makes it more expensive.

1. **Org on signup.** `POST /orgs` with the user's token; the creator becomes an
   owner. Create a default workspace ("All policies") as its three teams.
2. **Create documents under the org.** Replace `createPrivateCurrentUserRepo`
   with `POST /orgs/{org}/repos`, then attach the repo to the three teams of its
   workspace.
3. **Backfill.** For each existing user holding document repos: create an org
   (name derived from the user, suffixed on collision), then
   `POST /repos/{owner}/{repo}/transfer` with `new_owner` = the org and
   `team_ids` = the default workspace teams. **Transfer preserves issues, pull
   requests, reviews, comments and tags** — the entire audit record moves intact,
   which is the fact that makes this migration acceptable at all. Existing
   per-repo collaborators become org members in the role team matching their
   permission.
4. **Re-key billing.** Map each existing `subscriptions.username` to its new org
   id; carry `subscription_access_overrides` across the same way.
5. **Keep per-repo collaborators as the exception.** Outside counsel who should
   see exactly one document is a legitimate residual use, and the natural home for
   #364's one-time approval links.
6. **Retire the config-branch policy file.** Stamp the effective policy into the
   annotated tag and merge commit at publish time first — that is the part with
   evidentiary value and it can ship on its own. Then move
   `blockOnUnresolvedThreads` into the settings table, reading through to
   `.bindersnap/config.json` for repos that still carry one, and stop writing new
   config branches. Existing config branches are left in place; they are history,
   and deleting them buys nothing.

Verification before the old path is deleted: every pre-migration document URL
resolves, every pre-migration approval is present in the record, and an
integration test covers the migrated path end to end.

## Consequences

**Good.**

- Removing a person cannot orphan a document.
- Adding a member grants access to a workspace's documents in one call.
- The second workspace costs nothing — no new membership list, no new invoice.
- Seats are derived from Gitea, so billing cannot silently drift from reality.
- Document identity stays `org/repo` for life. Moving a document between
  workspaces is a team re-attachment: no URL breaks, no git remote breaks. For a
  compliance record, a link that never rots is worth more than a tidy URL.

**Costs, accepted.**

- Three role teams per workspace must be kept in sync (mitigated above).
- Repo names are unique per org, so two workspaces cannot both own the slug
  `dress-code`. Slugs get a disambiguating suffix; the display name is metadata.
  Some collision handling is needed within one workspace regardless.
- Org names contend in Gitea's global namespace. Acceptable: one name per
  customer, and it is their own brand.
- Two legal entities wanting two invoices need two orgs.

**The tripwire.** This makes Gitea's org and team model load-bearing for
permissions. If we ever need a permission Gitea cannot express, the answer is a
new ADR — not an app-side ACL table added quietly. Permissions are enforcement,
and enforcement stays where the merge happens.

## Reversal: TECHNICAL_VISION Q6

Q6 decided "one Gitea repository per workspace; documents are `.json` files
within it." That is reversed. **One repository per document** (ADR 0001), because
approval rules and branch protection are per document and a repository is the
smallest thing Gitea can protect. A workspace is a set of teams over many such
repositories.

## Scope Note

This ADR is design only. It authorizes the schedule in #370 and constrains #365,
#366, #369 and #371; it lands no code. The naming of these containers in the UI
is deliberately left open — "workspace" is engineering vocabulary, and "binder"
may serve the ICP better. That is a copy decision, not an architecture one, and
it interacts with #352.
