# Organizations, access and approvals — the backend half of finishing ADR 0004

Companion to [`org-access-ux.md`](./org-access-ux.md), which is the same design
seen from the screen. Rests on [`gitea-28-findings.md`](./gitea-28-findings.md)
for every claim about Gitea 28.0.0 — that file cites source, this one does not
re-argue it.

Status: proposed. Nothing here is built.

[ADR 0004](../adr/0004-organization-workspace-folder-and-org-billing.md) settled
the containers — org, binder, folder, document — and step 2 built the document
half of it. What it never finished is **the organization as a thing you
administer**: who is in it, what they can do, how they get in, how they get out,
and who may spend money. That is what this document settles.

## What is already there

Worth stating plainly, because it changes what this work is. The Gitea client
layer is largely done. `services/api/gitea-client/orgs.ts` already exports
`createOrganization`, `listOrganizationTeams`, `createWorkspaceTeams`,
`grantTeamOnRepo`, `revokeTeamFromRepo`, `addTeamMember`, `removeTeamMember`,
`listTeamMembers`, `listOrganizationOwners`, `isOrganizationOwner`,
`listBillableSeats` and `countBillableSeats`. `workspaces.ts` provisions a binder
with its three role teams and a protected `main`.

**The gap is routes and screens, not Gitea plumbing.** Of the eight sections
below, exactly two need new Gitea calls; the rest need a BFF endpoint over a
function that already exists, and a page that calls it. That is the cheapest this
has looked, and it is why the build order at the end is short.

---

## 1. The organization's own shape

ADR 0004 says the organization is "who we bill, and who your people are" and then
spends its remaining pages on binders. Finishing it means answering three
questions it left open: what roles exist above the binder, how the whole staff
reads policies, and what a department is.

### 1.1 Two org-level roles, and both are already Gitea objects

| Role       | Is                                    | May                                                                            |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| **Owner**  | Gitea's built-in `Owners` team        | Everything: billing, create and delete binders, add and remove people, promote |
| **Member** | Anyone in the org who is not an owner | Whatever their binder teams say, and nothing more                              |

That is the whole org-level role model, and the argument for keeping it at two is
that every third role anyone proposes turns out to be a binder role wearing a
costume. "Compliance lead" is a manager of the binders they run. "Auditor" is a
reviewer on everything. Neither needs a rung above the binder, and a rung above
the binder is the expensive kind: it is org-wide, it is invisible from the binder
that it affects, and Gitea will not enforce a distinction we invent.

**Rejected: a separate billing role.** It is tempting — the person with the
company card is often not the person who runs the policy manual. But ADR 0004
already decided billing reads the Owners team, Gitea has no finer primitive, and
inventing a `billing` team means the BFF checks an app-side membership list to
decide who may spend money. That is an app-side ACL over a permission question,
which is the tripwire. If a customer needs their finance person to hold the card
without running the binders, the answer is that finance is an owner and the
binders' day-to-day is delegated by binder role — which is true anyway.

`GET /users/{username}/orgs/{org}/permissions` answers the org-level question in
one call and returns `is_owner` directly. That is the guard for every owner-only
route, and it is more reliable than anything derived from team names.

### 1.2 How the whole staff reads the policy manual

Issue #371 needs every employee to read policies in order to attest to them.
ADR 0004 §6 says read is uniform within a binder and stops there, which leaves the
uncomfortable implication that adding four hundred nurses to a binder is four
hundred `addTeamMember` calls per binder.

**Decision: one org-level `staff` team, granted onto a binder when that binder is
open to the organization.**

```
staff   units_map: { repo.code: read, repo.pulls: read, repo.issues: read }
        includes_all_repositories: false
```

Every member of the organization joins `staff` when they join. Granting it onto a
binder is one call, and it gives the whole company read, comment, approve and
reject in that binder — the same unit map `<ws>-reviewers` already carries, which
is not a coincidence: it is the reviewer permission, held once for the org instead
of once per binder.

**`includes_all_repositories` is deliberately false**, and that single field is
what keeps the design honest. With it true, every binder is readable by everyone
forever and there is no way back — an HR investigation binder or a board-minutes
binder becomes impossible, and the only remedy is a second organization, which
breaks billing. With it false, granting `staff` is a per-binder act, and the
product gets a switch instead of a law:

> **Who can see this binder?** Everyone at Riverside Health · Only people I add

An **open** binder grants `staff`. A **restricted** binder does not, and its
`<ws>-reviewers` team carries the named readers instead. Both are the same
primitive — a team granted onto a repository — so there is one code path, and the
binder's visibility is **derived** by asking whether `staff` appears in
`GET /repos/{owner}/{repo}/teams`. Nothing is stored. A stored copy could disagree
with Gitea, and the one that matters is the one Gitea enforced.

Cost, stated: a `staff` grant means everyone can also _approve_ in that binder,
because read on `repo.pulls` is what approving is. For an internal policy manual
that is right — it is the same conclusion ADR 0004 reached for reviewers — and
where it is wrong, the answer is a restricted binder. It costs nothing in seats:
a seat is write or better on `repo.code`, and `staff` is read.

### 1.3 Departments are not teams, and must not become them

Issue #371 wants departments. The tempting move is to make a department a Gitea
team, since both are named groups of people.

**Rejected, and the reason is the direction of the coupling.** A department is a
fact about a person's job — it drives attestation reporting, "which policies does
Nursing owe", and the org chart. A team is a grant of access. They overlap most of
the time and diverge exactly when it matters: a nurse educator sits in Nursing and
needs write in Clinical Policies; an infection-control lead sits in Quality and
must approve half of Nursing's folders. Fuse them and every reporting correction
becomes a permission change, silently, with no review. Somebody fixing a typo in
the org chart grants access.

**Decision: departments are SQLite configuration; teams are Gitea access; the
seam between them is a bulk action, never a sync.** The UI may offer "add everyone
in Nursing as reviewers on this binder", which writes team membership once and
then forgets where the list came from. There is no reconciler, because a
reconciler is exactly the fusion this rejects.

This also satisfies the ADR's decision procedure without argument: Gitea does not
model a department, a department is not evidence about what happened, therefore it
is configuration, therefore it is a table.

---

## 2. Getting people in — the gap ADR 0004 does not know it has

**Gitea has no organization invitation API.** There is no `POST /orgs/{org}/members`;
`/orgs/{org}/members` is `GET` only. The only way a person joins an organization is
`PUT /teams/{id}/members/{username}`, which requires the account to already exist.
Gitea cannot invite anyone by email, and it cannot hold a pending invitation.

This is the single largest missing piece behind "how do we add people", and it is
not a screen — it is state that has to live somewhere.

Under ADR 0004's own decision procedure the answer is unambiguous: Gitea does not
model it, an unaccepted invitation is not evidence about a document, therefore it
is configuration, therefore it is a SQLite table.

```
organization_invitations
  id              text primary key      -- random, unguessable; this is the link
  gitea_org_id    integer not null
  email           text not null
  org_role        text not null          -- 'owner' | 'member'
  binder          text                   -- optional: the binder to land them in
  binder_role     text                   -- 'admins' | 'authors' | 'reviewers'
  invited_by      text not null
  created_at      integer not null
  expires_at      integer not null
  accepted_at     integer
  accepted_by     text                   -- the Gitea username that accepted
```

Three properties this needs, and they are the whole design:

- **The invitation grants nothing until it is accepted.** Acceptance is what calls
  `addTeamMember`. An expired or revoked invitation is a row nobody acts on, so it
  cannot leave a permission behind.
- **Acceptance is bound to the email, not to the link alone.** The account that
  accepts must verify the invited address, or the link is a bearer token that
  grants org membership to whoever it is forwarded to.
- **Losing the table loses pending invitations and nothing else.** People re-send
  them. That is the asymmetry ADR 0004 relies on to put configuration in SQLite,
  and this row satisfies it.

Removal is native and needs no table: `DELETE /orgs/{org}/members/{username}`
removes the person from the org and every team in it. Their commits, versions,
approvals, reviews and comments are git objects and stay exactly where they are —
which is the product's entire claim, and the thing to say on screen.

---

## 3. Reading "who can do what here" without N calls

The obvious endpoint is a trap, and it has now bitten twice.

`GET /repos/{owner}/{repo}/collaborators/{collaborator}/permission` returns
`permission.AccessMode`. Team access granted **per unit** — which is exactly how
`<ws>-authors`, `<ws>-reviewers` and `staff` are defined — lands in a different
field that endpoint never reads. It answers `none` for a member who can push. This
is the same shape as defect 8 in the implementation status, one layer down, and it
generalizes: **no per-user endpoint answers this correctly.**

**Decision: the binder's membership read model is teams-first, and it is a fixed
number of calls.**

```
GET /repos/{org}/{binder}/teams          →  the teams granted here (2–4)
GET /teams/{id}/members                  →  once per team
```

Four or five calls for the whole membership list, regardless of how many people
are in it — against one call per member for an answer that would be wrong. The
role is the team the person is in, and where somebody appears in two teams the
higher one wins, computed the same way `listBillableSeats` already ranks access.

The org-level answer is separate and is one call:
`GET /users/{username}/orgs/{org}/permissions` for `is_owner`.

**Individual repository collaborators are forbidden.** Gitea supports them and we
will not use them. They are a second source of truth for the same question, they
are invisible to the teams read model above, and the endpoint that would surface
them is the one that lies. A binder's access is its teams, entirely, and
`tests/gitea-permission-model.pw.ts` should gain an assertion that a provisioned
binder's collaborator list is empty — a drift test for a rule that is otherwise
only a habit.

### Team sprawl, and why it is accepted

Three role teams per binder means an organization with twenty binders has sixty
teams plus `Owners` and `staff`. That is a long list in Gitea's own UI.

**Accepted, because the alternative is worse and ADR 0004 already rejected it once.**
The alternative is org-wide role teams (`authors`, `reviewers`) granted onto
binders individually — which collapses the team count but also collapses the
roles: everyone in `authors` would have write on every binder they are granted,
and "Jane writes in Clinical Policies but only reviews in HR" becomes
inexpressible. The whole point of a binder is that it is _different people_.

The costs are real and bounded: a long team list in Gitea's admin UI, which no
customer sees because they never open Gitea; and team creation on the binder
provisioning path, which already happens. The mitigations that matter are naming
(`<binder>-authors` sorts together) and the read model above, which never
enumerates the org's teams to answer a binder question.

---

## 4. Per-folder sign-off, and why 28.0.0 changes the answer

This is the section the Gitea upgrade is for.

### 4.1 What was wrong with the shipped answer

ADR 0004 concluded that a CODEOWNERS entry must **name people, not teams**, because
Gitea writes a team review request and then clears its own `official` flag, so a
team code owner blocks no merge. That finding is still true on 28.0.0 —
`AddTeamReviewRequest` still does it — and it has a consequence ADR 0004 states but
does not price:

> "a folder's owners are a list of people, which has to be regenerated when the
> people change"

Regenerating means committing a new `.gitea/CODEOWNERS` to `main`. `main` is
protected. So **every personnel change becomes a pull request in every binder where
that person is named** — and it needs approval from the very code owners the file
is being edited to change. A departing employee stays a required approver until a
change removing them is approved. For a compliance manager with twenty binders,
that is not a workflow, it is an outage.

### 4.2 What 28.0.0 fixes

`block_on_codeowner_reviews` evaluates code owners directly and expands team
members, without consulting officialness at all. **Team code owners enforce.**

So the folder rule can name a group, and changing who is in that group is one
Gitea call — instant, no commit, no approval, no stale file. The CODEOWNERS file
changes only when the _rule_ changes ("Nursing is signed off by Infection
Control"), which is a policy decision that genuinely should be reviewed, rather
than a personnel fact that should not.

**That is the whole case for the upgrade**, and it is worth stating in one line:
28.0.0 turns "who approves this folder" from a file that goes stale into a group
that does not.

### 4.3 The design

**CODEOWNERS is generated, never hand-edited, and it names teams.**

An approver group is an org team with no repository grants at all — a _committee_.
It grants nothing (ADR 0004: "a team granted onto no repository grants access to
nothing and costs nothing"), it costs no seats, and it exists purely to be named
in CODEOWNERS. Committees are reusable across binders and folders, which is what
keeps this from re-creating the sprawl of §3.

A rule may still name individuals where a customer wants one named person, because
28.0.0 enforces both. The default is a committee, and the reason to prefer it is
§4.1.

The generated file:

```
policies/nursing/.*          @riverside-health/infection-control
policies/pharmacy/.*         @riverside-health/pharmacy-committee
```

Three mechanics the generator must respect, each of which fails silently if it
does not:

- **Patterns are anchored regexes, not globs.** `ParseCodeOwnersLine` compiles
  `^<pattern>$`. A folder rule is `policies/nursing/.*`; the `policies/nursing/`
  a GitHub habit produces matches nothing at all.
- **Folder names must be regex-escaped.** A folder called `Q1 (2026)` contains
  regex metacharacters. Unescaped, the rule silently matches the wrong files or
  nothing. This is the defect nobody finds until an audit.
- **The file is read from the base branch**, so a CODEOWNERS change never governs
  its own change. Correct for an approval control, and it means the _existing_
  approvers of `main` approve a change to the rules — which is the right
  authority.

**There is no `folder_approvers` table.** The file on `main` is the source, and the
UI reads and parses it. A table would shadow a git object that Gitea enforces at
merge time, and a shadow that disagrees with Gitea is a bug in the direction that
matters. Parsing one small file per binder is cheap; being wrong about who must
sign off is not.

**Changing the rules is an approved change, and that is a feature.** The BFF writes
the regenerated file onto a branch and opens a pull request titled in the
customer's language, not git's. Section 4 of the UX document designs how that
reads. It is worth being loud about rather than apologetic: a product whose claim
is that nothing changes without approval should not exempt the approval rules.

### 4.4 Fail-closed, and what we owe it

The gate blocks the merge when CODEOWNERS is oversized, unreadable, or when rule
matching runs out of its time budget. That is the right direction — the opposite
of `parseReviewSettings`, which ADR 0004 criticises for degrading _silently to the
permissive policy_ so that a corrupt byte turns off a control.

But we generate the file, so a generator bug becomes a binder that cannot publish
at all. The generator therefore owes three things before it commits:

1. Compile every pattern it emits, and refuse to commit a file with one that does
   not compile.
2. Refuse to commit a file above a conservative size ceiling.
3. Verify every referenced team exists in the org, because a rule naming a deleted
   team is a rule nobody can satisfy.

### 4.5 The recommended branch protection for a binder

Today `protectWorkspaceMain` sends:

```
required_approvals, enable_approvals_whitelist: true,
block_on_rejected_reviews: true, block_on_official_review_requests: true,
block_on_outdated_branch: true, dismiss_stale_approvals: true, enable_push: false
```

On 28.0.0 it becomes:

| Field                               | Value                                      | Why                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enable_push`                       | `false`                                    | The product's core claim: `main` changes only by approved merge                                                                                                                          |
| `required_approvals`                | binder's setting                           | How many, uniform per binder — that is what a binder means                                                                                                                               |
| `enable_approvals_whitelist`        | `true`                                     | Still required. `required_approvals` resolves officialness the old way, so without it a free reviewer's approval counts for nothing                                                      |
| `approvals_whitelist_teams`         | the binder's teams, plus `staff` when open | Whoever may approve must be listed, or their approval is decorative                                                                                                                      |
| `block_on_codeowner_reviews`        | **`true`** (new)                           | Per-folder sign-off becomes enforcement rather than assignment                                                                                                                           |
| `block_on_official_review_requests` | **`false`** (was `true`)                   | It was only ever on to make CODEOWNERS block, which it never did for teams. Left on it now blocks on _manually_ requested reviews, so any member could stall a publish by requesting one |
| `block_on_rejected_reviews`         | `true`                                     | A rejection should stop a publish                                                                                                                                                        |
| `block_on_outdated_branch`          | `true`                                     | A version approved against a stale base is not the version published                                                                                                                     |
| `dismiss_stale_approvals`           | `true`                                     | A new version resets approvals. Note it also removes those approvals from the code-owner gate, which filters dismissed reviews — the two gates agree, deliberately                       |
| `ignore_stale_approvals`            | `false`                                    | `dismiss_stale_approvals` already handles staleness; setting both is two mechanisms for one rule                                                                                         |

The two whitelist rows are the ones to read twice. **The gates resolve officialness
differently**: `required_approvals` counts only official reviews, so it needs the
whitelist; `block_on_codeowner_reviews` passes `OfficialOnly: false` on purpose, so
it does not. A design that assumes one rule for both will be wrong in exactly one
of them, and it will be wrong quietly.

---

## 5. The Gitea 28.0.0 upgrade

There is no `gitea/gitea:1.28-dev` image; Gitea dropped the `1.` prefix, so there
is no 1.28 at all. The `*-dev` tags on Docker Hub are stale since 2023. The only
image carrying this code is `gitea/gitea:main-nightly`.

The timing is better than it looks: milestone `28.0.0` is 402 closed against 10
open and its due date (2026-08-28) has already passed, and 1.27.0 went from `rc0`
to release in a fortnight. This is weeks, not quarters.

**Recommendation, in three parts:**

1. **Dev goes to a digest-pinned `main-nightly` now.** Not the moving tag — a
   digest. A moving tag means the stack changes underneath a green CI run and the
   next failure has no cause anyone can name, which is exactly the debris problem
   the implementation status already documents. `bun run down` destroys the dev
   volumes anyway, so a schema migration in dev costs nothing.
2. **Production waits for a released tag.** `deploy/files/litestream.yml`
   replicates `/data/gitea/gitea.db`, Gitea runs its migrations on start, and
   28.0.0 includes `v1_28/v345.go`. **A migration is a one-way door**: Gitea has no
   downgrade, so rolling back to `1.27.3` means restoring Litestream to a point
   before the start and losing everything written since. Litestream will have
   faithfully replicated the migrated schema, which is correct and no help at all.
   Nightly code and a one-way door do not belong in the same change.
3. **The upgrade is its own PR**, touching two lines — `docker-compose.yml:25` and
   `deploy/files/docker-compose.prod.yml:22` — plus the tests below. It carries no
   feature.

**What the test must assert**, before anything depends on 28.0.0 behaviour:

- `tests/gitea-permission-model.pw.ts` passes unchanged. It is the executable
  proof of the whole permission model and a major version is the moment to run it.
- `block_on_codeowner_reviews` round-trips: `POST`/`PATCH` a branch protection with
  it and read it back from `GET`.
- The per-rule gate: two folders with different owner teams, one change touching
  both, one approval — still blocked; the second approval — released. This is the
  assertion that proves the feature, because per-rule is the part that differs
  from "one approval overall".
- A team code owner blocks the merge, and a member's approval releases it. The
  existing test asserts the _opposite_ on 1.27.3, so it must be rewritten rather
  than extended, and the old assertion kept as a comment explaining why it flipped.
- Fail-closed on a deliberately malformed CODEOWNERS.
- The author-only-rule waiver, because it is the one branch that _loosens_ the
  gate, and a mistake there is silent.

**Only one breaking change is flagged across the milestone** —
`feat(actions)!: add RUN_RETENTION_DAYS…` — and neither compose file enables Gitea
Actions. That is a reassuring signal, not a clearance; the release notes still owe
a read when they appear.

**If 28.0.0 slips**, nothing in sections 1–3 or 5–7 is blocked. Only §4 is, and
its fallback is the shipped behaviour: name individuals, accept that a personnel
change is an approved change, and do not build the committee UI. That fallback is
bad enough to be worth waiting for — which is the honest reason to say the feature
justifies the upgrade rather than the other way round.

---

## 6. Billing, finished

### Who may manage it

Gitea org owners, read from `GET /users/{username}/orgs/{org}/permissions`
(`is_owner`), enforced in the BFF on every billing mutation — checkout, portal,
and any future plan change. Not read from a team name, and not stored.

### The three unanswered product decisions

These are the product owner's to make. Here is a position on each, with the
reasoning, so they can be disagreed with concretely.

**1. Signup funnel — no card, 14-day trial, land in the binder.**

Take the trial. The card-up-front funnel exists because the old app had nowhere
else to put a new account; #393 gives it somewhere. Asking a compliance manager for
a card before they have seen a single policy in the product is asking them to
involve procurement before they have anything to show it, which is the slowest
possible path in exactly this market. The cost is tire-kicker organizations in the
database, which is a row, and ADR 0004 already chose a local `trial_ends_at`
column precisely so a trial creates no Stripe object.

**2. Read-only mode — build it, and make it visible.**

The API rule has been enforced since #392 but no customer can exercise it, because
the SPA redirects an unpaid session to `/billing`. That redirect is worse than a
paywall: it hides the customer's own records behind a bill, which is the one act
ADR 0004 says would poison a compliance reference permanently. The API already does
the right thing; the SPA is telling a lie about it.

Contract: `requireSubscription` answers **402** with a typed body the SPA can
render rather than guess at —

```json
{ "error": "subscription_required",
  "organization": "riverside-health",
  "reason": "past_due" | "canceled" | "trial_expired" | "revoked",
  "canManageBilling": false }
```

`canManageBilling` is on the body because the banner's call to action differs for
an owner and a member, and the SPA should not have to make a second call to find
out which it is. `GET /api/app/billing/status` carries the same fields so the shell
can render the banner before anything is refused.

**3. Do org owners cost a seat — yes.**

`listBillableSeats` already counts them, via the Owners team, and it should keep
doing so. ADR 0004 identified the avoidance path itself: exclude owners and an
organization that notices moves everyone into Owners and pays for nobody. Beyond
the loophole, it is the only rule that survives being said out loud to a customer:
**anyone who can change a document is a seat; anyone who can only read, comment and
approve is free.** Carving out owners makes that sentence false and replaces it
with a table.

The counter-argument — that a finance owner who never touches a policy pays for a
seat they do not use — is real and is answered by the sentence, not by an
exception: they _can_ change a document, and the permission is what is priced. If
that becomes a live objection in a sales conversation, the fix is `admin_grant`,
which already exists as the comp mechanism.

---

## 7. The API surface

All of these follow the conventions step 2 settled: the organization is in the
path, handlers act with the caller's own Gitea token, and something the caller
cannot see answers 404 rather than 403.

| Method   | Path                                                     | Who                   | Does                                                                                 |
| -------- | -------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `GET`    | `/api/app/orgs/{org}`                                    | any member            | Name, display name, the caller's own org role, counts                                |
| `GET`    | `/api/app/orgs/{org}/people`                             | any member            | The membership read model: person, org role, department, seat or free                |
| `DELETE` | `/api/app/orgs/{org}/people/{username}`                  | owner                 | `DELETE /orgs/{org}/members/{username}`. Refused for the last owner                  |
| `POST`   | `/api/app/orgs/{org}/people/{username}/role`             | owner                 | Promote or demote: add to or remove from `Owners`. Refused for the last owner        |
| `GET`    | `/api/app/orgs/{org}/invitations`                        | owner                 | Pending rows from `organization_invitations`                                         |
| `POST`   | `/api/app/orgs/{org}/invitations`                        | owner                 | Create a row and send the email. Grants nothing yet                                  |
| `DELETE` | `/api/app/orgs/{org}/invitations/{id}`                   | owner                 | Revoke                                                                               |
| `POST`   | `/api/app/invitations/{id}/accept`                       | the invited person    | Verify the address, then `addTeamMember` into `staff` and any named binder team      |
| `GET`    | `/api/app/orgs/{org}/departments`                        | any member            | SQLite                                                                               |
| `POST`   | `/api/app/orgs/{org}/departments`                        | owner                 | SQLite                                                                               |
| `GET`    | `/api/app/binders/{org}/{binder}/people`                 | anyone who can see it | Teams-first read model of §3, plus whether `staff` is granted                        |
| `POST`   | `/api/app/binders/{org}/{binder}/people`                 | binder admin          | `addTeamMember` into the role's team                                                 |
| `DELETE` | `/api/app/binders/{org}/{binder}/people/{username}`      | binder admin          | `removeTeamMember` from every role team here                                         |
| `POST`   | `/api/app/binders/{org}/{binder}/people/{username}/role` | binder admin          | Move between role teams — add then remove, in that order                             |
| `POST`   | `/api/app/binders/{org}/{binder}/visibility`             | binder admin          | Grant or revoke `staff`, and rewrite `approvals_whitelist_teams` to match            |
| `GET`    | `/api/app/binders/{org}/{binder}/rules`                  | anyone who can see it | Branch protection plus the parsed CODEOWNERS                                         |
| `PATCH`  | `/api/app/binders/{org}/{binder}/rules`                  | binder admin          | Required approvals and thread policy. Immediate — these are settings, not evidence   |
| `POST`   | `/api/app/binders/{org}/{binder}/rules/sign-off`         | binder admin          | Regenerate CODEOWNERS onto a branch and **open a change**. Returns the change number |
| `GET`    | `/api/app/orgs/{org}/committees`                         | any member            | Org teams with no repository grants                                                  |
| `POST`   | `/api/app/orgs/{org}/committees`                         | owner                 | Create one                                                                           |
| `POST`   | `/api/app/orgs/{org}/committees/{team}/members`          | owner                 | `addTeamMember`. **No commit, no approval** — this is §4.2's payoff                  |

Two rows deserve a second look. `visibility` rewrites the approvals whitelist in
the same handler, because granting `staff` read without whitelisting it produces
readers whose approvals silently do not count — the exact decorative-reviewer
failure ADR 0004 caught once already. And `rules/sign-off` returns a change number
rather than a success, because it did not take effect; something has to be
approved first, and the caller must be told that in a way it cannot ignore.

---

## 8. Data model

Everything new is configuration. No evidence moves.

| Table                             | Columns                                                               | Why it is configuration                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `organization_invitations`        | as §2                                                                 | Gitea cannot hold a pending invitation at all. Losing it loses unsent invites and no access                                   |
| `departments`                     | `id`, `gitea_org_id`, `name`, `created_at`                            | Gitea has no department. Not a fact about what happened                                                                       |
| `organization_member_departments` | `gitea_org_id`, `username`, `department_id`                           | A fact about a person's job today, not about a document                                                                       |
| `binder_settings`                 | `gitea_org_id`, `binder`, `block_on_unresolved_threads`, `updated_at` | The one rule with no Gitea equivalent. Moves `blockOnUnresolvedThreads` off the config branch, which ADR 0004 step 5 asks for |
| `settings_events`                 | `id`, `gitea_org_id`, `binder`, `actor`, `field`, `from`, `to`, `at`  | Append-only telemetry about administration. Who relaxed a control and when                                                    |

**Deliberately not tables:**

- **Binder visibility.** Derived by asking whether `staff` is granted. A stored copy
  could disagree with the grant Gitea enforces.
- **Folder approvers.** `.gitea/CODEOWNERS` on `main` is the source, parsed on read.
  A table would shadow a git object that Gitea evaluates at merge time.
- **Seats.** Already derived by `listBillableSeats`, and ADR 0004's reason holds:
  there is no seat table to drift.
- **The `document_versions` derived index.** Out of scope for this arc. The binder
  model already made the list cheap — `listVersionsByDocument` reads a binder's tags
  once rather than once per document — so it is an optimization, and optimizations
  wait for a page that is slow.

---

## 9. Build order

Seven pieces, each its own branch and pull request, each shippable alone. Only
piece 5 is blocked on Gitea 28.0.0, and it is placed late on purpose so the upgrade
can slip without stalling anything.

| #   | Piece                             | Ships                                                                                                  | Proven by                                                                                                                      | Needs 28.0.0 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | **The membership read model**     | `GET .../people` for org and binder, teams-first; the `staff` team created at org provisioning         | A binder with a member in each role reports all three roles correctly, in a bounded number of Gitea calls                      | no           |
| 2   | **Managing binder people**        | Add, remove, change role; the `visibility` switch and its whitelist rewrite                            | A reviewer promoted to author can push; demoted, cannot. Granting `staff` puts it in `approvals_whitelist_teams`               | no           |
| 3   | **Managing org people**           | Promote and demote owners, remove from org, the last-owner refusal                                     | The last owner cannot be removed or demoted, by either route                                                                   | no           |
| 4   | **Invitations**                   | The table, the four routes, the email, address-bound acceptance                                        | An invitation grants nothing until accepted; an expired one grants nothing ever; a forwarded link fails on a different address | no           |
| 5   | **Committees and sign-off rules** | Committee CRUD; the CODEOWNERS generator with its three validations; `rules/sign-off` opening a change | Per-rule enforcement across two folders; regex-escaped folder names; a malformed file refused before commit rather than after  | **yes**      |
| 6   | **Binder settings and events**    | `binder_settings`, `settings_events`, `blockOnUnresolvedThreads` off the config branch                 | The publish gate reads the row; every change writes an event                                                                   | no           |
| 7   | **Read-only mode**                | The typed 402 body, `canManageBilling` on billing status                                               | A delinquent org's `GET`s all succeed; its mutations all answer 402 with a reason; `paywall-scope.test.ts` still passes        | no           |

The Gitea upgrade is its own PR, sequenced between 4 and 5, carrying no feature.

---

## 10. What this document does not verify

Everything about 28.0.0 is read from merged source, not from a running server;
[`gitea-28-findings.md`](./gitea-28-findings.md) §6 lists exactly what to stand up
and assert, and none of §4 should be depended on until it passes.

Beyond that, four claims here are reasoned rather than tested:

| Claim                                                                                                                                      | What would settle it                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `staff` team granted read on `repo.code`/`repo.pulls`/`repo.issues` lets its members approve, and their approval counts once whitelisted | Extend `tests/gitea-permission-model.pw.ts` with a staff-team case — the same assertion it already makes for `<ws>-reviewers`                                   |
| The teams-first read model returns the same answer as asking the repository as each member                                                 | A test that builds a binder with all four teams and compares the two answers member by member                                                                   |
| `GET /users/{username}/orgs/{org}/permissions` reports `is_owner` for an Owners-team member and not for a `staff` member                   | One integration assertion; it is the guard on every owner-only route, so it should not be assumed                                                               |
| A committee — an org team granted onto no repository — costs no seat                                                                       | `listBillableSeats` already encodes the rule ("granted onto at least one repository"); a test that creates a committee and asserts the seat count does not move |
