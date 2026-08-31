# ADR 0004: Organization, Workspace, Folder — and Billing the Organization

Status: Accepted (design)  
Date: 2026-08-31  
Related: [#370](https://github.com/davidgraymi/bindersnap-editor-demo/issues/370) (this ADR),
[#369](https://github.com/davidgraymi/bindersnap-editor-demo/issues/369) (repricing),
[#365](https://github.com/davidgraymi/bindersnap-editor-demo/issues/365) (grouping),
[#366](https://github.com/davidgraymi/bindersnap-editor-demo/issues/366) (database),
[#371](https://github.com/davidgraymi/bindersnap-editor-demo/issues/371) (departments),
[#373](https://github.com/davidgraymi/bindersnap-editor-demo/issues/373) (review cycle),
[#209](https://github.com/davidgraymi/bindersnap-editor-demo/issues/209) (organizations)

**Supersedes ADR 0001's core model** — "one document equals one Gitea repository"
— and nothing else in it. ADR 0001's upload → branch → pull request → review →
merge → tag contract is unchanged and remains law; only the container it happens
inside of changes. Restores the container half of TECHNICAL_VISION Q6 (one repo
per workspace) and drops its file-format half (documents need not be `.json`).
Amends the datastore rule in `AGENTS.md`.

## Why This Exists

Today a document is a Gitea repository owned by **the person who created it**
(`createPrivateCurrentUserRepo`, `services/api/gitea-client/repos.ts`), shared by
adding per-repo collaborators one at a time. Five things break off that one fact:

1. **Billing has nothing to bill.** `subscriptions.username` is keyed to a person.
2. **Access does not scale.** A compliance officer joins 200 policies one call at
   a time.
3. **Nothing is shared.** No workspace-wide policy, reviewer pool, activity view,
   or audit export.
4. **Ownership is a person.** When the creator leaves, the customer's compliance
   record leaves with them. In healthcare that is disqualifying.
5. **No department dimension.** Nothing to attach a department to (#371).

## Decision

**Four levels. Three of them are Gitea primitives, and the fourth is a directory.**

| Level            | Is                                   | Its one job                          |
| ---------------- | ------------------------------------ | ------------------------------------ |
| **Organization** | A Gitea organization                 | Who we bill, and who your people are |
| **Workspace**    | A Gitea repository owned by that org | What rules apply, and who can act    |
| **Folder**       | A directory inside that repository   | How you find things                  |
| **Document**     | A file inside that directory         | The record itself                    |

The rule a customer can hold in their head:

> **If you need different rules or different people, make a workspace. If you just
> need to find things, make a folder.**

A workspace is a binder: a set of policies governed together, by the same people,
under the same rules. That is what a repository already is.

### 1. The organization is a Gitea org, and it owns everything

One organization per customer. Every workspace repo is owned by the org, never by
a person. Every human is a member of that one org, so a second workspace costs no
new membership list. Signup creates the org — there is no personal mode that has
to be upgraded later, because that upgrade is the migration being paid for now.

This is what fixes ownership: removing a person removes a member, never a record.

### 2. The workspace is the repository

Everything a workspace has to be, a repository already is:

| A workspace needs      | A Gitea repository has                                 |
| ---------------------- | ------------------------------------------------------ |
| Members and roles      | Collaborators and org teams granted onto it            |
| Rules                  | Branch protection on `main`                            |
| Per-folder rules       | `.gitea/CODEOWNERS`                                    |
| A place for documents  | The tree                                               |
| Folders                | Directories                                            |
| An ownership boundary  | The owning org                                         |
| A complete audit trail | Its commits, pull requests, reviews, comments and tags |

**Rejected alternative: workspace as a set of Gitea teams**, with documents staying
one-repo-each. It works, and it was this ADR's first answer, but it requires three
role teams per workspace to be kept holding the same repo set — Gitea will not
enforce that, so it needs a reconciler and a drift test, and a document attached to
the authors team but not the reviewers team is invisible to the people who must
approve it. Making the workspace the repository reduces that repo set to size one
and the entire failure mode disappears. It also deletes the folder table and the
per-document policy store, which are two more things that were only needed because
the workspace was not a real object.

Roles are org teams, each granted onto its workspace repo:

| Team             | Access                                       | Who              |
| ---------------- | -------------------------------------------- | ---------------- |
| `<ws>-admins`    | Admin on the repo                            | Workspace owners |
| `<ws>-authors`   | Write — push branches, open changes, merge   | Paid seats       |
| `<ws>-reviewers` | Read on code; comment and approve on changes | **Free** (#369)  |

Reviewers can open, comment on, approve and reject a change; they cannot push a
version or merge. That is a Gitea permission, not an app check, which is what makes
"reviewers are free forever" safe to promise. **The exact unit map
(`repo.code` / `repo.pulls` / `repo.issues`) must be verified against Gitea 1.25
before implementation** — the claim that a read-on-code team can still submit a
review is the load-bearing one.

### 3. Folders are directories

`policies/infection-control/`. They nest as deep as a customer wants, they appear
in a clone, and they cost nothing to create. #365's "should a folder govern rules"
is answered in the next section — by CODEOWNERS, natively, better than the
metadata layer this ADR originally proposed.

### 4. A change is a pull request, and it may touch several documents

The unit of approval is **the change, not the document**. A pull request that
revises three cross-referencing policies together is a feature, not a leak: policies
that reference each other should be revised and approved as one act, and a reviewer
should see them together.

Consequences, stated so they are not surprises:

- **Versions are per-document tags on the shared merge commit.** Publishing a change
  that touched three documents creates three tags — `infection-control/v4`,
  `handover/v2`, `medication-admin/v7` — all pointing at the same commit. Several
  tags on one commit is ordinary git.
- **Approvals cover the whole change.** "Who approved v4 of infection control" is
  answered by tag → commit → pull request → reviews. The record is exact.
- **CODEOWNERS composes.** A change touching a nursing policy and an HR policy
  requests reviewers from both. Cross-cutting revisions automatically pull in every
  owner, which is the correct behaviour and falls out for free.

### 5. Rules: branch protection, plus CODEOWNERS for per-folder reviewers

`main` is protected with `enable_push: false`, so the only way any file changes is a
merged, approved pull request — the product's core claim, unchanged from ADR 0001.

- **How many approvals** is `required_approvals`, uniform across the workspace. That
  is what a binder means. A set of policies needing a different number is a different
  binder, and binders are now cheap.
- **Who must approve** is `.gitea/CODEOWNERS`, per folder, enforced by pairing it
  with `block_on_official_review_requests` so a merge is blocked while a code
  owner's requested review is outstanding. Verify that pairing on 1.25 before
  betting the feature on it.
- **Reset approvals on a new version** is `dismiss_stale_approvals`, as today.
- **Block on unresolved threads** has no Gitea equivalent, so it stays enforced by
  the BFF at publish time — now once per workspace instead of once per document,
  as a settings row rather than a committed file.

CODEOWNERS is the one piece of configuration that belongs in git rather than in a
table, and it is worth saying why, because it is the exception that proves the rule
in "What State Lives Where" below: it is read at pull-request time and lives on the
same timeline as the content it governs, so `?ref=<tag>` genuinely answers "who
owned this policy when this version was approved." It passes the point-in-time test.
A settings row does not need to.

### 6. Access is uniform within a workspace

Everyone with read on the repo reads every document in it. For the target customer —
a healthcare organization whose policy manual is internal, and whose staff must be
able to read policies to attest to them (#371) — that is correct rather than merely
tolerable.

External one-off reviewers (outside counsel, a surveyor) are **not** repo members.
They come in through #364's one-time links, which the BFF serves with the service
account, scoped to a single document. That keeps the tripwire below intact: no
app-side ACL over a repo the user can already read.

## Billing

### The organization is the billing entity, and the second workspace is free

One Stripe customer per organization. **Workspaces are never metered, and neither
are documents.** Metering the container would push a customer to cram everything
into one binder to save money — defeating the structure, and repeating at the
container level the mistake #369 identifies at the person level.

> Price the value — people authoring governed policy. Never price the containers,
> and never price the record.

**A billable seat is a distinct human with write access to any workspace in the
org** — that is, a member of any `-admins` or `-authors` team. Counted once no
matter how many binders they author in; highest right wins. Reviewers are free and
are not seats.

The count is therefore **derived from Gitea team membership**, not stored. There is
no seat table to drift, and the nightly reconcile (`services/api/stripe/reconcile.ts`)
is a recompute rather than a repair.

Shape to hand to #369: an org-level plan with a base price including a band of
authors, plus per-author overage — one predictable line item for procurement,
annual and invoiced for design partners, with the existing `admin_grant` override as
the comp mechanism.

### Key on the Gitea org id, not its name

`subscriptions` moves from `username TEXT PRIMARY KEY` to
`gitea_org_id INTEGER PRIMARY KEY`, with the org name denormalized for display only.
Gitea renames both users and orgs (`POST /orgs/{org}/rename`), so the current
username key silently breaks on rename today. Same change for
`subscription_access_overrides`.

### Trial and access precedence

`resolveAccess` gains one layer. Highest first:

1. `admin_revoke` — no access.
2. `admin_grant` — access.
3. Stripe `active` / `trialing`, with the existing 3-day grace on a stale
   `current_period_end`.
4. Local trial: `organizations.trial_ends_at` in the future.
5. Otherwise, no access.

The 14-day trial (#369) is a local column rather than a Stripe trialing subscription.
#369 wants no card at all during the trial, and representing that in Stripe would
create a customer and a subscription for every tire-kicker. The cost — two sources of
access truth — is contained by the single precedence list above, which is one
function.

### Reading the record is never gated

Structural, not a nicety: **the paywall gates authoring and mutation; it never gates
reading or exporting.** When an org has no access, mutations are blocked for everyone
in it, including reviewers — the org is delinquent, not the person. Reads and exports
stay open regardless, forever. Holding a customer's approval history hostage is the
one act that would poison a compliance reference permanently.

That is also cleaner than #369's proposed route-by-route audit: gate by intent, and
let a test assert that no `GET` under `/api/app/documents` calls
`requireSubscription`.

### Who can change billing

Gitea org owners, read from the Owners team — not an app-side role table. If the
last owner leaves, that is an ops path; the admin override already exists.

## What State Lives Where

`AGENTS.md` says Gitea is the only datastore with sessions as the sole exception.
That stopped being true when Stripe landed: `subscriptions`,
`subscription_access_overrides`, `processed_webhook_events` and
`webhook_customer_state` are all SQLite. Rather than widen an exception one feature
at a time, this section replaces the rule with a decision procedure.

### The three questions, in order

**1. Does Gitea model it natively?** Branch protection, org membership, teams and
their permissions, pull request reviews, assignees, review requests, reactions,
labels, topics. If yes, **use the Gitea primitive and never shadow it.** Gitea keeps
these in its own database and enforces them at merge time. A copy that disagrees with
Gitea is a bug, and the one that matters is the one Gitea enforced.

**2. Is it evidence?** A fact about _what happened_ that a surveyor could ask us to
prove, where "our database says so" is not an acceptable answer. Documents, versions,
who approved, when, what they said, what changed. **Evidence is a git object in the
workspace repository** — a commit, a pull request, a review, a comment, a tag. It
never moves. Not to SQLite, not as an optimization.

**3. Everything else is configuration.** How the app should behave right now:
workspace display names, department lists, review cadence, notification preferences,
billing. **A typed, indexed, migrated SQLite table.** Not a file in a git repo.

### Why configuration does not go in a git repo

Git uniquely provides two things: tamper-evident history that travels with a clone,
and a point-in-time read of any file as of any commit or tag (`?ref=v3.2`). That
second property is the whole reason to accept its costs.

Its costs, concretely: every read is a network round trip with no local index; every
write is two to four API calls plus permanent objects; there is no cross-object query,
so any question spanning documents is N calls; no transaction across files; no types
or constraints — `parseReviewSettings` must tolerate a malformed file, and it degrades
**silently to the permissive policy**, so a corrupt byte turns off a control.

The existing `.bindersnap/config.json` does not even buy the point-in-time property:
`bindersnap-config` branches off `main` once and then diverges, so there is no ref at
which "the policy as of version 3.2" can be read. It pays every cost above for a
change log that an append-only table gives us indexed, in one query.

This is the answer to "Gitea keeps its settings in a database, so do ours need to be
in a repo?" **No.** Gitea is right. CODEOWNERS is the exception, for the reason given
in section 5.

### When configuration shapes evidence, stamp it onto the event

> **Git stores what happened. The database stores how the app is configured. When
> configuration shapes what happened, do not version the configuration — stamp it
> onto the event.**

At publish, the effective policy is written into the annotated tag and the merge
commit: approvals required, who approved, whether thread resolution was enforced.
That is better evidence than a versioned config file in every way that matters —
immutable, attached to the exact event, no join against historical settings, and
readable from a bare clone with no application running.

A settings _change_ is still worth recording — who relaxed the thread requirement,
and when. That is an append-only `settings_events` table. It is telemetry about
administration, not evidence about a document.

### Derived indexes, and the document version index

A **derived index** in SQLite is permitted under three conditions that keep it from
becoming a second source of truth:

1. It is **rebuildable from Gitea from scratch** by a job that takes no input but
   Gitea.
2. **No request handler writes it as its primary action.** It is populated from Gitea
   webhooks and by the reconciler, after Gitea has confirmed the change.
3. **Dropping it loses nothing but speed.** Where it disagrees with Gitea, Gitea wins
   and the reconciler is the bug report.

**The worked example is document version state**, and it is the case that earns the
category. Tags are repo-global, so "the current version of every document in this
binder" means walking every tag and filtering by prefix — a 200-policy binder with
twenty versions each is four thousand tags, eighty paginated calls, on a page load.
The tags remain the evidence; a `document_versions` index answers the browsing
question:

- workspace repo, document path, current version tag
- the commit SHA that tag points at, and the pull request that published it
- published at, published by, approvers
- open change count

Keying every row on an **immutable git coordinate** (tag name and commit SHA) is what
makes it safe: a row is either correct or detectably stale, never subtly wrong. If the
SHA does not match what Gitea reports for the ref, the row is rebuilt.

And one rule decides every future case: **the index serves browsing; Gitea serves
proving.** The documents list, the due queue (#373) and completion reporting (#371)
read the index. The publish gate, the approval check and the audit packet (#368) read
Gitea. Nothing that gates a decision or ends up in front of a surveyor is allowed to
depend on the index — which is why the index being wrong can never hurt anyone.

Note that the binder model makes this cheaper in both directions: a full rebuild walks
one repository per workspace instead of two hundred, and the documents list drops from
roughly three Gitea calls per document to a handful per workspace.

### The table

| Fact                                                     | Where                                 | Why                                       |
| -------------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| Organization identity, membership                        | Gitea org                             | Native                                    |
| Workspace existence, name, contents                      | Gitea repository                      | Native                                    |
| Who can do what in a workspace                           | Gitea teams granted onto the repo     | Native, enforced by Gitea                 |
| Folders                                                  | Directories in the repository         | Native                                    |
| Approvals required, stale dismissal                      | Gitea branch protection               | Native, enforced at merge                 |
| Who must approve which folder                            | `.gitea/CODEOWNERS`                   | Read at PR time, same timeline as content |
| Documents, versions, changes, reviews, threads, tags     | Git objects in the workspace repo     | Evidence (ADR 0001's contract)            |
| The policy in force at a publish                         | Stamped into the tag and merge commit | Evidence, self-contained                  |
| Block-on-unresolved-threads, review cadence, departments | SQLite                                | Configuration; no Gitea primitive         |
| Settings change history                                  | SQLite, append-only                   | Administrative telemetry                  |
| Stripe customer, subscription, trial, overrides          | SQLite                                | Commercial                                |
| Document version state, list and queue read models       | SQLite, derived                       | Speed only; rebuildable                   |

### What this costs, honestly

Losing the SQLite file costs sessions, billing, review cadence, department lists and
policy settings. It costs **no evidence** — not one document, version, approval,
comment, review, membership or permission. Policies revert to defaults and admins
re-set them; nothing a customer could be asked to produce in an audit is gone. That
asymmetry is the whole justification for the split, and it is why the durability
answer is Litestream (ADR 0003) plus the staleness alarm in #221 rather than storing
configuration in git to avoid trusting a database we already trust with sessions and
money.

**The tripwire, and it is the one that matters.** This is the direction #366 asks
about, and it stops here. Configuration and derived indexes may live in SQLite.
**Evidence may not.** Any proposal to move a document, a version, an approval, a
review, a comment, a membership or a permission out of Gitea is a new ADR arguing that
on its own merits — not a patch, and not a performance fix.

## Retiring a Document

Retiring a policy is `git rm` in an approved change: the file leaves `main`, and every
version, approval and comment it ever had stays in the repository's history, reachable
by path. Nothing is destroyed, and the retirement is itself an approved, attributed
event.

This is strictly better than what one-repo-per-document offered, where "delete this
document" meant deleting the repository and the record with it.

The one thing the binder model cannot do is _purge_ a document — expunge its history so
the bytes are gone — without rewriting the whole binder's commit graph and invalidating
every other document's SHAs. That is a records-destruction-schedule operation, not a
retirement, and no target customer has asked for it. If one does, it is a question for
that conversation, not a reason to shape the architecture now.

## Migration

Production data is minimal today. This is the cheapest this migration will ever be.

1. **Org and first workspace on signup.** `POST /orgs` with the user's token; the
   creator becomes an owner. Create the first workspace repo, protect `main`, and
   create its three role teams.
2. **Documents are files.** Replace `createPrivateCurrentUserRepo` and the
   one-repo-per-document upload path with a commit to a path inside the workspace repo.
   ADR 0001's branch → pull request → review → merge → tag contract is unchanged; only
   the target repository and the path are new.
3. **Backfill.** For each existing user holding document repos: create an org and one
   workspace repo, then for each old document repo replay its history into a path in
   the new repo. **Replay, not transfer** — `POST /repos/{owner}/{repo}/transfer` moves
   a repository whole, which is the wrong shape now. Preserve, per document: every
   published version as a commit with its original author and date, the version tags
   (re-namespaced under the document's path), and the approval record. Where fidelity
   is impossible, write the original pull request's reviews into the migration commit's
   message rather than dropping them, and keep the source repositories archived and
   read-only until the migrated record has been verified against them.
4. **Re-key billing.** Map each `subscriptions.username` to its new org id; carry
   `subscription_access_overrides` across the same way.
5. **Retire the config-branch policy file.** Stamp the effective policy into the
   annotated tag and merge commit first — that part has evidentiary value and can ship
   on its own. Then move `blockOnUnresolvedThreads` to a per-workspace settings row.

**The migration is where the evidence is at risk, and it is the part of this ADR that
deserves the most care.** Verification before any source repository is deleted: every
pre-migration document is reachable at its new path, every published version has a tag,
every approval is either preserved as a review or recorded in a commit message, and an
integration test covers a migrated document through a full change-and-publish cycle.
Deleting the source repositories is a separate, later, deliberate act.

## Consequences

**Good.**

- Removing a person cannot orphan a record.
- Adding a member grants access to a whole binder in one call.
- The second workspace costs nothing — no new membership list, no new invoice.
- Folders, per-folder reviewer rules, and workspace rules are all native primitives.
  Three app-level constructs from this ADR's first draft — a folder table, a
  per-document policy store, and a team↔repo reconciler — are not built at all.
- A binder is one `git clone`: the whole policy manual with its complete history, which
  is most of #368.
- Seats are derived from Gitea, so billing cannot silently drift from reality.

**Costs, accepted.**

- Read access is uniform within a workspace. Correct for an internal policy manual;
  external reviewers go through #364 links, which this makes a dependency rather than a
  nice-to-have.
- Approval counts are uniform within a workspace. Different counts mean a different
  binder.
- Version tags share one namespace and are prefixed by document path; the version index
  above is what keeps that off the page-load path.
- A workspace repository grows without bound as binary versions accumulate. Total bytes
  are the same as before, but they are now one object per customer rather than one per
  document — so clone and export time scale with the binder, and the blast radius of a
  corrupted repository is a binder rather than a policy.
- Reversing ADR 0001's core model touches upload, publish, tagging, the comparison view,
  the audit export and every `/docs/:owner/:repo` route. It is the largest change so far
  and it is cheapest today.

**Tripwires.**

- **Permissions stay where the merge happens.** If we ever need a permission Gitea
  cannot express, that is a new ADR — not an app-side ACL added quietly.
- **Evidence stays in Gitea.** Configuration and derived indexes may live in SQLite;
  nothing else may.

## Open Before Implementation

Two claims this design rests on that have not been verified against Gitea 1.25:

1. A team with read on `repo.code` and write on `repo.pulls` can submit a pull request
   review, so reviewers can approve without write access.
2. `.gitea/CODEOWNERS` plus `block_on_official_review_requests` blocks a merge while a
   code owner's requested review is outstanding — that is, CODEOWNERS is enforcement
   and not only auto-assignment.

If (1) is false, the free-reviewer tier needs a different permission shape. If (2) is
false, per-folder rules fall back to per-workspace rules and #365 gets a smaller answer.
Verify both against the local stack before writing any of this.
