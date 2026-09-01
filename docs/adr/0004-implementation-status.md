# ADR 0004 — implementation status

Working notes for the series implementing
[ADR 0004](./0004-organization-workspace-folder-and-org-billing.md). Delete this
file when the series lands.

## Where the series stands

| PR                                                                     | Branch                         | State                                 |
| ---------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| [#389](https://github.com/davidgraymi/bindersnap-editor-demo/pull/389) | `…-1-verify-gitea-permissions` | **merged**                            |
| [#390](https://github.com/davidgraymi/bindersnap-editor-demo/pull/390) | `…-2-orgs-teams-client`        | **merged**                            |
| [#391](https://github.com/davidgraymi/bindersnap-editor-demo/pull/391) | `…-3-workspace-provisioning`   | open — one integration failure, below |
| [#392](https://github.com/davidgraymi/bindersnap-editor-demo/pull/392) | `…-4-reads-never-gated`        | open — inherits #391's failure        |
| [#393](https://github.com/davidgraymi/bindersnap-editor-demo/pull/393) | `…-5-bill-the-organization`    | open — inherits it too                |

Branches stack `3 → 4 → 5`. A fix on a lower branch must be merged forward
before pushing. Everything except the one failure below is green: unit, seed,
build, formatting, CodeQL and the rest of the integration suite.

## The one open failure

`tests/signup-provisioning.pw.ts:83` — after `POST /auth/signup`, Gitea answers
`GET /user/orgs` with `[]` for the new user, so no organization was created.
It fails identically on all three retries.

`provisionSignupBestEffort` swallows the cause by design (a Gitea hiccup must
not strand someone at a login form for an account that exists) and logs it at
error level. That log now survives the run — see below — so **the next step is
to read it, not to re-derive it.**

### The cause, found

The api.log capture answered it on its first run
([job 99855912222](https://github.com/davidgraymi/bindersnap-editor-demo/actions/runs/33507742009/job/99855912222)):

```json
{
  "level": "error",
  "message": "Failed to provision organization at signup",
  "username": "signup-…",
  "status": 403,
  "error": "%!s(<nil>)"
}
```

**403, with a nil error body.** Gitea emits exactly two `403`s that log a nil
error, and only one is on this path — `routers/api/v1/org/org.go:248`:

```go
if !ctx.Doer.CanCreateOrganization() {
    ctx.APIError(http.StatusForbidden, nil)   // formats as %!s(<nil>)
    return
}
```

So Gitea is refusing at `CanCreateOrganization()`, which is

```go
u.IsAdmin || (u.AllowCreateOrganization && !setting.Admin.DisableRegularOrgCreation)
```

Every signup fails this way, not just the one the test asserts on — the same
error line appears for each `stripe-*` user in the run.

`AllowCreateOrganization` is set once, at user creation, from
`setting.Service.DefaultAllowCreateOrganization && !setting.Admin.DisableRegularOrgCreation`
(`models/user/user.go`, `createUser`). Gitea's admin `CreateUserOption` has **no
field for it**, so `createGiteaUser` cannot ask for it in the payload — the
stack's Gitea settings decide, and this stack sets neither, so both should be
at their permissive defaults. Resolve that contradiction before choosing a fix;
the two candidate fixes are:

1. Set `GITEA__service__DEFAULT_ALLOW_CREATE_ORGANIZATION=true` explicitly in
   `docker-compose.yml` and `deploy/files/docker-compose.prod.yml`, so the
   behaviour does not depend on a Gitea default that can move under us. Cheap,
   and it makes the requirement legible next to the other `GITEA__` settings.
2. Have `createGiteaUser` follow the create with
   `PATCH /api/v1/admin/users/{username}` carrying
   `allow_create_organization: true` (`EditUserOption` _does_ have the field).
   Independent of server configuration, at the cost of one more round trip on
   the signup path.

Prefer (1) if it reproduces, and add an integration assertion that a fresh user
can create an org, so a Gitea upgrade that flips the default fails loudly
instead of silently un-provisioning every new account.

### How to read the cause (for the next one)

`tests/global-teardown.ts` saves the whole API container log to
`test-results/api.log` before `docker compose down`, and the CI job uploads it
in `playwright-artifacts-*`. Download that artifact and:

```bash
grep '"level":"error"' api.log
grep 'Failed to provision organization at signup' api.log   # the line that matters
```

That line carries the HTTP `status` and Gitea's own `error` message from
whichever call failed.

### Already ruled out — do not spend time re-checking

- **Not visibility.** The org is created private, but `GET /user/orgs` calls
  `DoerViewOtherVisibility(doer, doer)`, which returns `VisibleTypePrivate`
  when the doer is the subject. Private orgs _are_ listed to their own members.
  So the empty list means provisioning genuinely failed.
- **Not token scope.** `REQUIRED_GITEA_TOKEN_SCOPES` is unioned into whatever
  is configured, so every session token carries `write:organization`, which is
  what Gitea's `POST /orgs` route requires.
- **Not the request shapes.** Every call the client emits was probed against a
  stub: correct method, URL, `token` auth header, `Content-Type` and body.
  `POST /api/v1/orgs` sends
  `{"username","full_name","visibility":"private","repo_admin_change_team_access":false}`.
- **Not the account flags.** Signup creates the user with
  `must_change_password: false` and `restricted: false`; a restricted user
  could not create an organization, and a must-change-password user is refused
  by Gitea's API middleware.

### Most likely remaining causes, in order

1. Something in `provisionWorkspace` after the org — but that would leave the
   org behind, and the list is empty, so the failure is at or before
   `POST /orgs`. Read the log before assuming otherwise.
2. `resolveAvailableOrganizationName` mis-reading a name as free. Note the real
   collision hazard it does have: `findOrganization` is a `GET /orgs/{org}`,
   and Gitea answers **404** for a private org the caller cannot see. So a
   second customer asking for the same display name is told the name is free
   and then gets a 422 from `POST /orgs`. `createOrganization` should treat 422
   as "taken" and step to the next candidate — the second test in
   `signup-provisioning.pw.ts` is exactly that case and has never run, because
   the file is `mode: "serial"` and the first test fails first.

## Known follow-on work once provisioning passes

- **Branch 3 gets trials but nothing reads them.** `requireSubscription` on
  branches 3 and 4 still calls `hasActiveSubscription(username)`; the trial only
  becomes an access source on branch 5. So the moment provisioning works, the
  Stripe suite's "new user is blocked by the paywall" assertion has to become
  trial-aware on the branch where trials start mattering. `POST /api/dev/end-trial`
  (dev-only) exists on branch 5 and probably belongs on branch 3.
- **`tests/document-collaborators.pw.ts:174`** failed once on #393 and was never
  diagnosed; a timing fix was applied on spec. Confirm it against a real run.

## Three product decisions still unanswered

Raised in the PR bodies, none answered. They change the work, so they are worth
settling before the next PR in the series:

1. **Signup funnel.** #369 says no card during the 14-day trial, which
   contradicts today's signup → `/billing` redirect. #393 changes the funnel to
   land in the workspace. Keep the card-up-front funnel instead, and the trial
   becomes opt-in.
2. **Read-only mode for delinquent orgs.** The API rule ("reads are never
   gated") is enforced as of #392, but the SPA still redirects every unpaid
   session to `/billing`, so a customer cannot yet exercise it. Building the
   real read-only mode — mutating controls disabled, a banner saying why — is
   its own piece of work.
3. **Do org owners cost a billable seat?** `listBillableSeats` counts any team
   with write or better on `repo.code` that is granted onto a repository, which
   includes Gitea's built-in Owners team. That is a pricing decision, not a
   naming accident — see #390's description.

## ADR scope not yet started

Documents as files inside the workspace repo (this reverses ADR 0001's
one-repo-per-document model), the `document_versions` derived index,
per-workspace settings and `settings_events`, CODEOWNERS generation — naming
**people, not teams**, per #389's finding — the document-repo backfill, and
workspace/folder in the SPA's navigation and URLs.
