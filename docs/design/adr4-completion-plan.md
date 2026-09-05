# Finishing ADR 0004 — the plan, and what it needs decided

Three documents, one arc:

- [`gitea-28-findings.md`](./gitea-28-findings.md) — what Gitea 28.0.0 changes,
  verified at source. Evidence, not design.
- [`org-access-architecture.md`](./org-access-architecture.md) — the backend.
- [`org-access-ux.md`](./org-access-ux.md) — the same design, seen from the screen.

This file is the sequencing and the decisions. It is short on purpose.

## Where ADR 0004 actually is

Step 1 (organization and billing) is merged bar #393. Step 2 (documents as files)
is six stacked pull requests, all green, none merged — the API is complete and the
SPA browses it read-only. What is left, per the implementation status, is team
management, writing from the binder UI, deleting the old one-repo-per-document
model, and four smaller items.

**This plan covers the first of those and the org half nobody has designed yet.** It
does not cover "writing from the binder UI" or "delete the old model" — those are
already specified and already sequenced, and they should land first because
everything here sits on top of the binder pages they finish.

## The two facts that reshaped the plan

**Gitea 28.0.0 adds `block_on_codeowner_reviews`**, which makes CODEOWNERS enforce
rather than merely assign, **and makes team code owners work**. ADR 0004 concluded
the opposite and settled on naming individuals — which means today, every time a
person joins or leaves an approver group, the fix is a pull request in every binder
that names them, approved by the very people being changed. 28.0.0 turns "who signs
off on this folder" from a file that goes stale into a group that does not.

The catch, which the findings document spends a section on: the underlying
team-review-request bug is **not** fixed, so teams work only under the new gate.
Switching CODEOWNERS to teams and switching the gate are one change, not two. That
bug is also a two-line upstream fix and is the subject of
[`org-access-architecture.md` §11](./org-access-architecture.md).

**Teams are organization objects, and binders adopt them.** The first draft of this
plan accepted three teams created per binder at provisioning — sixty for twenty
binders. The owner rejected the premise and it was the right call: it inverts
Gitea's model, it manufactures objects nobody asked for, and it makes a recurring
group of people un-reusable, which is the expensive half. Provisioning now creates
no teams; groups are named by the customer and granted onto binders; a per-binder
team is created lazily only when somebody grants an individual. See
[`org-access-architecture.md` §3](./org-access-architecture.md).

## Decisions taken

Answered by the product owner on 2026-09-04. Reasoning for each is in the section
named; recorded here because they gate work.

| #   | Question                               | Decided                                                                | Where                    |
| --- | -------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| 1   | Signup funnel                          | **No card, 14-day trial**, land in the binder                          | architecture §6          |
| 2   | Read-only mode for a delinquent org    | **Build it** — typed 402, banner, mutations disabled, reads never      | architecture §6, UX §6   |
| 3   | Do org owners cost a seat              | **Yes**, as `listBillableSeats` already counts them                    | architecture §6          |
| 4   | Is a binder open to the org by default | **Yes, and creating a binder asks** — the switch is on the create form | architecture §1.2, UX §2 |
| 5   | Gitea nightly in dev before 28.0.0     | **Yes in dev, digest-pinned**; production waits for a released tag     | findings §7              |
| 6   | Sidebar                                | **No.** Breadcrumb with switchers in the top nav; tabs within a scope  | UX §1                    |
| 7   | Role vocabulary                        | **Admin**, not "Manager". Editor survives as the one invented word     | UX §4.1                  |

Decision 6 reverses this plan's own earlier recommendation. The argument that
killed the sidebar is that the binder page and the document workspace both already
have tab bars, so a sidebar would put three levels of navigation chrome on one
screen — a fact about the pages rather than a matter of taste. UX §1 keeps the
reversal visible instead of quietly deleting it.

## Sequence

Backend and screens interleave, because each screen needs its endpoint and neither
is worth shipping alone.

| Order | Piece                                                    | Half              | Needs 28.0.0 |
| ----- | -------------------------------------------------------- | ----------------- | ------------ |
| 0     | Land the step-2 stack (#398 → #404)                      | shipped           | no           |
| 0     | Writing from the binder UI; delete the old model         | already specified | no           |
| 1     | Membership read model; `staff`; stop provisioning teams  | backend           | no           |
| 2     | Breadcrumb shell and scope tabs                          | screens           | no           |
| 3     | Organization page                                        | screens           | no           |
| 4     | Groups: create, grant onto a binder, whitelist recompute | backend           | no           |
| 5     | Managing binder people; the visibility switch            | backend           | no           |
| 6     | Managing org people; last-owner rule                     | backend           | no           |
| 7     | People and groups screens                                | screens           | no           |
| 8     | Invitations — table, routes, email                       | backend           | no           |
| 9     | Invite screens and pending state                         | screens           | no           |
| 10    | Read-only mode — typed 402 and the banner                | both              | no           |
| —     | **Gitea 28.0.0 upgrade**, its own PR, no feature         | ops               | —            |
| 11    | The CODEOWNERS generator                                 | backend           | **yes**      |
| 12    | Sign-off rules page                                      | screens           | **yes**      |

Eleven of the thirteen are unblocked. That is deliberate: the upgrade sits late so
it can slip without stalling anything, and if 28.0.0 lands early it can be pulled
forward without reordering a thing.

Piece 1 carries a behaviour change worth calling out on its own — `provisionWorkspace`
stops creating the three role teams. Binders provisioned before it keep theirs and
work unchanged, so there is nothing to migrate, but the provisioning test moves with
it.

Piece 10 is independent of every other piece and could go first.

## Upstream, in parallel

[`org-access-architecture.md` §11](./org-access-architecture.md) proposes four
contributions to Gitea, ranked. Only the first is worth starting now: a two-line
ordering fix in `AddTeamReviewRequest` that would make per-folder sign-off work on
the 1.27.3 already in production, and would remove the hard floor of 28.0.0 from
under pieces 11 and 12.

Nothing in the sequence above depends on any of them landing. That is the point of
listing them separately.

## What is not verified

Everything about 28.0.0 is read from merged source, not from a running server.
[`gitea-28-findings.md` §6](./gitea-28-findings.md) lists exactly what to stand up
and assert first, and [`org-access-architecture.md` §10](./org-access-architecture.md)
lists the claims in the backend design that are reasoned rather than tested.

Nothing in pieces 11 and 12 should be built until those assertions pass against a
digest-pinned nightly container.
