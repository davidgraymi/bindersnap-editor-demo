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
| **Folder**       | Metadata in the org's config repo   | How you find things                     |
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
`webhook_customer_state` are all SQLite. This ADR states the rule that was
actually being followed, and binds it:

> **If losing it would corrupt the audit record, it lives in Gitea. If losing it
> would only mean re-entering a credit card, it may live in SQLite.**
>
> SQLite may hold commercial facts and references to Gitea objects. It may never
> hold governance facts — who is a member, who may approve, what the policy is,
> what happened.

Drop the SQLite file and a customer loses their billing linkage and their
sessions. They lose no document, no version, no approval, no comment, no
membership, and no permission.

| Fact                                               | Where                                                   |
| -------------------------------------------------- | ------------------------------------------------------- |
| Organization identity, name                        | Gitea org                                               |
| Human identity, credentials                        | Gitea user                                              |
| Who belongs to the organization                    | Gitea org membership                                    |
| Workspace existence, name, roles                   | Gitea teams (`<ws>-admins/-authors/-reviewers`)         |
| Who can do what, where                             | Gitea team membership + unit permissions                |
| Which documents are in a workspace                 | Gitea team↔repo attachment                              |
| Document, versions, approvals, threads, audit      | Gitea repo / PR / reviews / comments (ADR 0001)         |
| Per-document review policy                         | `.bindersnap/config.json` on `bindersnap-config` branch |
| Workspace policy defaults, folders, departments    | `org.json` in the org's `.bindersnap` config repo       |
| Stripe customer / subscription / trial / overrides | SQLite                                                  |

### The org config repo

Workspace display names, review-policy defaults, the folder tree (#365), and the
department list (#371) have no Gitea primitive. They go in a private repo named
`.bindersnap` in the org, attached to no workspace team, holding
`workspaces/<slug>.json`.

This is not a second datastore — it is the pattern already blessed for
per-document policy (`reviewSettings.ts`), one level up. And it is better than a
SQLite row for a compliance product: every settings change is a commit with an
author and a timestamp, so "who changed the approval rule for the Nursing binder,
and when" is answerable by the same machinery that answers it for documents.

Two mechanics, stated so they are not re-litigated:

- **Writes are compare-and-swap** on the file SHA via the contents API, exactly as
  `reviewSettings.ts` does. Concurrent admins get a conflict, never a lost update.
- **Reads are not cached** (the no-cache rule stands). One small file over
  loopback from a co-located Gitea is acceptable. If it ever is not, the answer is
  conditional requests, not a database.

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
new ADR — not an app-side ACL table added quietly. That path is #366, and it is a
decision about the whole product, not a patch.

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
