# Finishing ADR 0004 — the plan, and what it needs decided

Three documents, one arc:

- [`gitea-28-findings.md`](./gitea-28-findings.md) — what Gitea 28.0.0 changes,
  verified at source. Evidence, not design.
- [`org-access-architecture.md`](./org-access-architecture.md) — the backend.
- [`org-access-ux.md`](./org-access-ux.md) — the same design, seen from the screen.

This file is the sequencing and the open questions. It is short on purpose.

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

## The one new fact that reshaped the plan

Gitea 28.0.0 adds `block_on_codeowner_reviews`, which makes CODEOWNERS enforce
rather than merely assign, **and makes team code owners work**. ADR 0004 concluded
the opposite and settled on naming individuals — which means today, every time a
person joins or leaves an approver group, the fix is a pull request in every binder
that names them, approved by the very people being changed.

28.0.0 turns "who signs off on this folder" from a file that goes stale into a group
that does not. That is the difference between a feature a compliance manager can run
and one they will abandon, and it is the reason the upgrade is worth planning around
rather than drifting into.

The catch, which the findings document spends a section on: the underlying
team-review-request bug is **not** fixed, so teams work only under the new gate.
Switching CODEOWNERS to teams and switching the gate are one change, not two.

## Sequence

Backend and screens interleave, because each screen needs its endpoint and neither
is worth shipping alone.

| Order | Piece                                            | Half              | Needs 28.0.0 |
| ----- | ------------------------------------------------ | ----------------- | ------------ |
| 0     | Land the step-2 stack (#398 → #404)              | shipped           | no           |
| 0     | Writing from the binder UI; delete the old model | already specified | no           |
| 1     | Membership read model + the `staff` team         | backend           | no           |
| 2     | Sidebar shell                                    | screens           | no           |
| 3     | Organization page                                | screens           | no           |
| 4     | Managing binder people; the visibility switch    | backend           | no           |
| 5     | Managing org people; last-owner rule             | backend           | no           |
| 6     | People pages                                     | screens           | no           |
| 7     | Invitations — table, routes, email               | backend           | no           |
| 8     | Invite screens and pending state                 | screens           | no           |
| 9     | Read-only mode — typed 402 and the banner        | both              | no           |
| —     | **Gitea 28.0.0 upgrade**, its own PR, no feature | ops               | —            |
| 10    | Committees and the CODEOWNERS generator          | backend           | **yes**      |
| 11    | Sign-off rules page                              | screens           | **yes**      |

Ten of the twelve are unblocked. That is deliberate: the upgrade sits late so it can
slip without stalling anything, and if 28.0.0 lands early it can be pulled forward
without reordering a thing.

Piece 9 is independent of every other piece and could go first if the delinquent-org
question becomes urgent.

## What needs deciding before piece 1

Three product questions, all raised in the step-1 and step-2 pull request bodies and
none answered. Each has a recommendation with reasoning in
[`org-access-architecture.md` §6](./org-access-architecture.md); they are collected
here because they gate work rather than merely inform it.

1. **Signup funnel** — no card and a 14-day trial, or card up front? _Recommended:
   no card._ Changes what piece 9's banner has to handle and what signup lands on.
2. **Read-only mode for a delinquent organization** — build it, or keep redirecting
   to `/billing`? _Recommended: build it._ It is piece 9.
3. **Do org owners cost a seat?** _Recommended: yes, as today._ Changes the seat
   arithmetic on three screens.

And two the plan itself raises:

4. **Is a binder open to the whole organization by default?** The design says yes —
   a `staff` team granted at creation, with a per-binder switch to restrict. It is
   the right default for an internal policy manual and the wrong one for an
   organization whose first binder is HR investigations. It is one line in
   provisioning either way.
5. **Do we take a nightly Gitea in dev before 28.0.0 releases?** _Recommended: yes
   in dev, digest-pinned; production waits for a released tag._ The findings document
   explains the one-way door that makes those two different answers.

## What is not verified

Everything about 28.0.0 is read from merged source, not from a running server.
[`gitea-28-findings.md` §6](./gitea-28-findings.md) lists exactly what to stand up
and assert first, and [`org-access-architecture.md` §10](./org-access-architecture.md)
lists the four claims in the backend design that are reasoned rather than tested.

Nothing in pieces 10 and 11 should be built until those assertions pass against a
`main-nightly` container.
