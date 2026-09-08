# Finishing ADR 0004 — the plan, and what it needs decided

Three documents, one arc:

- [`gitea-28-findings.md`](./gitea-28-findings.md) — what Gitea 28.0.0 changes,
  verified at source. Evidence, not design.
- [`org-access-architecture.md`](./org-access-architecture.md) — the backend.
- [`org-access-ux.md`](./org-access-ux.md) — the same design, seen from the screen.

This file is the sequencing and the decisions. It is short on purpose.

## Where ADR 0004 actually is

**Updated 2026-09-07.** Step 1 (organization and billing) is merged, #393
included. Steps 2 and 3 are built and green but live on
`feat/adr4-documents-as-files`, not on `main` — binders, the document page, the
change page, History, Settings, org and binder people, groups, and read-only
mode. What is left is invitations, deleting the old one-repo-per-document
model, and the pieces behind the Gitea 28.0.0 upgrade.

Originally, when this plan was written: step 1 was merged bar #393, and step 2
was six stacked pull requests, all green, none merged.

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

| Order | Piece                                                    | Half    | State                |
| ----- | -------------------------------------------------------- | ------- | -------------------- |
| 0     | Land the step-2 stack (#398 → #404)                      | shipped | **done**             |
| 0     | Writing from the binder UI                               | screens | **done** (#409–#415) |
| 0     | Delete the old model                                     | both    | **done**             |
| 1     | Membership read model; `staff`; stop provisioning teams  | backend | **done** (#416)      |
| 2     | Breadcrumb shell and scope tabs                          | screens | **done**             |
| 3     | Organization page                                        | screens | **done**             |
| 4     | Groups: create, grant onto a binder, whitelist recompute | backend | **done** (#417)      |
| 5     | Managing binder people; the visibility switch            | backend | **done** (#421)      |
| 6     | Managing org people; last-owner rule                     | backend | **done** (#421)      |
| 7     | People and groups screens                                | screens | **done**             |
| 8     | ~~Invitations — table, routes, email~~                   | backend | **descoped**         |
| 9     | ~~Invite screens and pending state~~                     | screens | **descoped**         |
| 10    | Read-only mode — typed 402 and the banner                | both    | **done** (#424)      |
| —     | **Gitea 28.0.0 upgrade**, its own PR, no feature         | ops     | **done**             |
| 11    | The CODEOWNERS generator                                 | backend | **done**             |
| 12    | Sign-off rules page                                      | screens | **done**             |

**Updated 2026-09-08.** Twelve of the thirteen are done, and the thirteenth is
not being built.

**Invitations are descoped**, on the product owner's call. Gitea can neither
hold a pending invitation nor send an email, and this repository has no mail
infrastructure at all — so finishing them needs a delivery decision and
credentials only a human can create. Instead, an organization adds a person who
already has an account: one route, one search-based form, and two costs written
down rather than rediscovered — somebody with no account cannot be added at
all, and nobody consents to being added. The rest is
[issue 426](https://github.com/davidgraymi/bindersnap-editor-demo/issues/426).

**The Gitea upgrade happened**, digest-pinned to a `main-nightly` in dev with
production left on 1.27.3, and its verification turned up one claim the design
had backwards — a CODEOWNERS pattern that does not compile is dropped silently
rather than failing closed. That became a requirement on the generator before
the generator existed.

**The old model is deleted too** — 20,000 lines out, the library rebuilt on
binders in the same change because it would otherwise have gone blank, and two
things named that would have disappeared silently: the regulator export, which
is now a binder's rather than one document's, and anonymous document viewing,
which has no surface at all until #364's one-time links exist
([issue 430](https://github.com/davidgraymi/bindersnap-editor-demo/issues/430)).

What is left is what the implementation status notes carry and this plan never
sequenced: the `document_versions` derived index and per-workspace settings. The
approvals whitelist on a binder's change page is **not** being built — with the
old model gone there is no way to reach a binder except through a team the
whitelist already names, so the state that screen would explain cannot happen.

Piece 10 went early, out of order, exactly as the note below predicted it
could.

Everything up to and including piece 10 lives on `feat/adr4-documents-as-files`
rather than on `main`. Landing that branch is its own act and is the largest
open risk in the series.

Originally: eleven of the thirteen were unblocked. That is deliberate: the upgrade sits late so
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
