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

## Defects found while getting this green

Each cost a CI round and is worth not rediscovering.

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

Also added: `tests/global-teardown.ts` saves the API container log to
`test-results/api.log` before the stack goes down and prints its error lines
into the job output. Defect 1 was invisible without it, because provisioning is
best-effort and swallowed the cause.

## Verified against Gitea 1.27.3

The 1.26 → 1.27.3 upgrade (#387) landed mid-series. Provisioning passes on it
unchanged. #389's CODEOWNERS finding was a reading of 1.26 source and is being
re-checked separately on `claude/reverify-codeowners-gitea-1273`.

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

## ADR scope not yet started

Documents as files inside the workspace repo (this reverses ADR 0001's
one-repo-per-document model), the `document_versions` derived index,
per-workspace settings and `settings_events`, CODEOWNERS generation — naming
**people, not teams**, per #389's finding — the document-repo backfill, and
workspace/folder in the SPA's navigation and URLs.
