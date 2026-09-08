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
| [#393](https://github.com/davidgraymi/bindersnap-editor-demo/pull/393) | Bill the organization               | **merged** |

### Step 2 — documents as files (2026-09-04)

Six PRs, each stacked on the one above it, **all merged into
`feat/adr4-documents-as-files`** rather than into `main`. That branch is the
integration branch for steps 2 and 3, and landing it on `main` is its own act.

| PR                                                                     | Branch                             | What it did                                             |
| ---------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| [#398](https://github.com/davidgraymi/bindersnap-editor-demo/pull/398) | `feat/adr4-1-workspace-api`        | A member creates a binder; the auto-created one is gone |
| [#399](https://github.com/davidgraymi/bindersnap-editor-demo/pull/399) | `feat/adr4-2-document-write-path`  | A document is a file inside the binder                  |
| [#400](https://github.com/davidgraymi/bindersnap-editor-demo/pull/400) | `feat/adr4-3-document-read-paths`  | Reading documents out of the binder                     |
| [#401](https://github.com/davidgraymi/bindersnap-editor-demo/pull/401) | `feat/adr4-4-publish-version-tags` | Publishing versions every document a change touched     |
| [#403](https://github.com/davidgraymi/bindersnap-editor-demo/pull/403) | `feat/adr4-6-seed-binders`         | The dev seed builds an org with binders                 |
| [#404](https://github.com/davidgraymi/bindersnap-editor-demo/pull/404) | `feat/adr4-7-binder-ui`            | `/{org}` and `/{org}/{binder}` pages                    |

[#402](https://github.com/davidgraymi/bindersnap-editor-demo/pull/402) (the
document backfill, `feat/adr4-5-backfill-documents`) is **closed, deliberately**
— see "Decisions taken" below. The branch survives on the remote if it is ever
wanted. `feat/adr4-documents-as-files` is an earlier name for #398's commit and
holds nothing extra.

### Step 3 — the document page, and adding one (2026-09-05)

| PR                                                                     | Branch                                 | What it did                                            |
| ---------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| [#409](https://github.com/davidgraymi/bindersnap-editor-demo/pull/409) | `feat/adr4-8-binder-document-page`     | `/{org}/{binder}/{path}` is a page, not Home           |
| [#410](https://github.com/davidgraymi/bindersnap-editor-demo/pull/410) | `feat/adr4-9-add-a-policy`             | A member adds a policy to a binder                     |
| [#412](https://github.com/davidgraymi/bindersnap-editor-demo/pull/412) | `feat/adr4-10-binder-change-page`      | A change has a page, and is decided on it              |
| [#413](https://github.com/davidgraymi/bindersnap-editor-demo/pull/413) | `feat/adr4-11-binder-repo-shell`       | The binder is laid out like a repository               |
| [#414](https://github.com/davidgraymi/bindersnap-editor-demo/pull/414) | `feat/adr4-12-binder-change-detail`    | The change view is the one that already existed        |
| [#415](https://github.com/davidgraymi/bindersnap-editor-demo/pull/415) | `feat/adr4-13-binder-history-settings` | History and Settings, the last two tabs                |
| [#416](https://github.com/davidgraymi/bindersnap-editor-demo/pull/416) | `feat/adr4-14-org-people-and-staff`    | The organization has people; binders stop making teams |
| [#417](https://github.com/davidgraymi/bindersnap-editor-demo/pull/417) | `feat/adr4-15-groups`                  | Groups: named, levelled, composed onto a binder        |

#404's row above used to claim the document page too. It did not ship one:
`binderDocument` was in the route table and in the nav's highlight rule, but
`AppShell` had no branch for it, so clicking a document in a binder fell
through the chain and rendered Home at the document's URL. This is that page —
the record as published, every version behind it, and what is waiting on a
decision.

Two things it needed that were not there:

- **Raw content had no route.** `GET /api/app/binders/{org}/{binder}/raw/{path}`
  serves the bytes at any ref. It is under `raw/` rather than a `/download`
  suffix because the document's path is the rest of the URL: a policy filed at
  `nursing/download` would otherwise be indistinguishable from a request to
  download `nursing`. Gitea addresses raw content the same way.
- **`DocumentPreview` was bound to `owner`/`repo`.** It now takes a
  `loadFile(ref)` callback, so the same preview serves a document that is a
  repository and one that is a file in a binder. Callers must `useCallback` it
  and keep it above their early returns — the hook order caught that in tests
  rather than in review.

The version rides in the query (`?version=2`) rather than in the path, for the
same reason `raw/` does: a `/version/2` suffix cannot be told apart from a
policy filed in a folder called `version`.

`paywall-scope.test.ts` now covers `/api/app/binders` as well as
`/api/app/documents`, and asserts both prefixes actually match routes — a
prefix that matched nothing would let half the rule go unenforced in silence.

What the page does not do yet, deliberately: a binder's open changes are listed
as facts rather than links, because a binder change has no page of its own. And
an uploaded-but-unpublished document is still unreachable — `main` is the
record, so the binder's list and its document endpoint both answer from `main`.
That is the next piece, and it is what "writing from the binder UI" runs into
first.

### A binder shows what is proposed, not only what is filed

`main` is the record, so a policy uploaded an hour ago is not in the tree —
and the binder's list read only `main`. A member who added a policy was shown
a binder that did not contain it, in the one moment they are watching.

The list now carries those documents too, as `state: "proposed"`. They are
derived from the open changes the list already fetches, through the
`upload/<slugPath>/…` branch convention (`documentSlugPathFromUploadBranch`),
so they cost no extra Gitea call — asking which files each change touches
would be a call per change, which is the cost the binder exists to remove.

The price is that the extension is not knowable that cheaply, so `path`, `size`
and `sha` are **null** for a proposed document. `WorkspaceDocumentListEntry` is
therefore no longer an extension of `WorkspaceDocumentEntry`: that type
describes a file that exists, and this list also carries documents that do not
exist on `main` yet. A row is addressed by `slugPath`, which is known either
way, and the document's own page pays for the exact path once — it falls back
to the pending upload branch and returns `ref`, so the page reads the file out
of the change.

**The seed did not follow the convention, and nothing was checking.** Every
branch in `dev.yaml` omitted the document's folder —
`upload/infection-control-policy/…` for a document at
`nursing/infection-control-policy`. That seeded fine and looked right in
Gitea, but the app read it as a change about a different document at the
binder's root: the real policy lost its open-change badge (already wrong
before this piece, through `changeTouchesDocument`), and once proposed
documents were listed, three policies that do not exist appeared beside the
real ones. `parseSeedScenario` now refuses a branch that does not start with
`upload/<slugPath>/`, and the thirteen branches are fixed.

Worth knowing when this bites you: `bun run down` does **not** clear Gitea,
whose data is a bind mount under `data/` rather than a volume. Changing branch
names left the old ones behind, and the re-seed then opened a pull request
with nothing in it, which Gitea refuses to merge with "Please try again
later". `bun run up --fresh` is the fix, and that message is not about timing.

### A change is decided on its own page

ADR 0004 makes the change the unit of approval, so it gets a page rather than
a panel under one of the documents it touches: `/{org}/{binder}?change=3`. On
the binder, because one change can version several documents and belongs to
none of them; in the query, because `/{org}/{binder}/changes/3` cannot be told
apart from a policy filed at `changes/3` — the same reason `?version=` is a
query.

`GET .../changes/{n}` answers what the page needs in one call: the change and
its reviews, every document it would version with the version each would
reach, whether threads are blocking, and whether it is behind. `POST
.../changes/{n}/reviews` records an approval or a request for work. Publish
already existed but had never been registered in the OpenAPI registry, so
there was no generated client for it — the SPA could not have called it.

**The publish button was a trap, and finding out cost a browser session.** A
binder protects `main` with `block_on_outdated_branch`, so a change that
branched off before another one merged is refused however many approvals it
has — which is correct, approvals should be against the content that lands,
but it was a dead end with no way out from the UI. Every seeded open change
was in exactly that state. So:

- `isBehind` comes off the pull request Gitea already returned — the merge
  base is the base branch's head exactly when the change is up to date, so
  knowing costs nothing.
- `POST .../changes/{n}/update` merges `main` into the change. **A merge, not
  a rebase**: a rebase replays the change's commit onto the new head, which
  git cannot do for the binary files most policies are, and it fails with
  "your local changes would be overwritten by merge". Verified against the
  live Gitea — the rebase style errors on a `.docx`, the merge style does not.
- It moves the branch, so `dismiss_stale_approvals` drops the approvals
  collected so far. That is correct, and it is why this is an explicit act
  with the cost stated rather than something publish does quietly.
- Gitea recomputes the merge base **after** accepting the push, so the
  endpoint polls until Gitea agrees before answering. Returning on the 200
  made the page redraw the very state it had just fixed.

Being behind outranks the approval count in the wording, because bringing a
change up to date dismisses approvals — telling somebody to go collect them
first sends them to do wasted work.

**`isApproved` and `isRejected` were in the response contract from the
beginning and nothing ever set them.** `isRejected` therefore read `undefined`,
which is falsy, and both places that gate on it — `documentsView.isReady` and
`homeChanges.classify` — were checking nothing: a change one reviewer had
asked for work on, but which had its approvals from others, was shown as
"ready to publish" on Home. The cause was two copies of the same row shape,
`buildPendingChangeRow` and an inline block in the document detail handler,
which drifted. There is one now, and it sets both from `approvalState`, which
already folds each reviewer's latest answer the way Gitea merges on.

### The binder is laid out like a repository

The product owner rejected the shape the binder pages were growing into, and
was right to: each screen had been invented on its own, and the change view in
particular was a thinner second version of a change-request UI the app already
had. A binder **is** a Gitea repository, and the layout people already know for
one — a name, a description, and a row of tabs — is a baseline a customer can
read without being taught.

So the binder now has a header and tabs, and each screen inside it is a pane
rather than a page: **Documents** (what is in it) and **Change requests** (what
is being changed), with History and permissions to follow. One document opens
under the same header with Documents still marked, because a document is a file
inside the binder — its own trail says `nursing / Infection Control Policy`,
the part the header above it cannot say.

Tabs ride in the query (`?tab=changes`) for the reason `?version=` and
`?change=` do: `/{org}/{binder}/changes` cannot be told apart from a policy
filed at `changes`, and neither can `history` or `settings`. The tab a binder
opens on carries no query at all, so a binder's own address stays the short
one.

**`DocumentChanges` is reused whole** — the Open/Closed filter, the outcome
icons, the approval meters, the "who is holding this up" wording. It needed one
change: the row's "becomes v4 when published" is a fact only a list about one
document can state, so it takes an optional `describeSubject` instead, and a
binder's rows say "Infection Control Policy" while open and "Infection Control
Policy v1" once published.

Two endpoints back it:

- `GET /api/app/binders/{org}/{binder}` — the header. The two counts live here
  rather than in each tab's payload because the tab bar shows both at once:
  somebody reading Documents still needs to see that three changes are waiting.
- `GET /api/app/binders/{org}/{binder}/changes?state=open|closed` — one shape
  for open and closed alike, because the list shows them in one place and a row
  reads the same either way. Two shapes is what let `isRejected` go missing from
  one of them.

Naming what a change is about costs nothing either way: an open change carries
its document in its `upload/<slugPath>/…` branch name, and a published one is
named exactly by the version tags on its merge commit — one tags read for the
whole binder rather than a `/pulls/{n}/files` call per change.

`resolveClosedOutcome` is pulled out of `buildClosedChanges` so the binder's
list reaches "declined" and "withdrawn" by the same rule rather than a second
copy of it.

### The change view is the one that already existed

The thin review screen written for #412 is gone. A binder's change now renders
`DocumentChangeDetail` — the same discussion, timeline, comparison, reviewer
list, approval confirmation and publish gate the per-document workspace has,
which is roughly 2,500 lines that were being duplicated badly rather than
reused.

**The seam is a `ChangeScope`**, not a bag of callbacks, because that is all
that differs: a pair of names, plus — for a binder — which document inside it
the change's file operations are about.

```ts
type ChangeScope =
  | { kind: "document"; owner: string; repo: string }
  | { kind: "binder"; org: string; binder: string; documentPath: string };
```

`api.ts` turns it into a URL and nothing else needs to know. Five components
(`DocumentChangeDetail`, `ReviewTimeline`, `ChangeReviewers`,
`DocumentComparison`, `DocumentDetail`) traded `owner`/`repo` props for one
`scope`, and eleven functions in `api.ts` traded them for one argument.

Six operations got a binder address, and **every one of them delegates to the
document model's own handler**: discussions, replies, resolution, comment
reactions, change updates, reviewer assignment, plus the binder's
collaborators. A binder is a Gitea repository and a change on it is a Gitea
pull request, so this is routing, not behaviour — one namespace per shape of
thing rather than a second implementation.

Two things the change detail needed that the payload did not carry:

- **`canManage`**, from `readWorkspaceAccess`. Not the collaborator endpoint: a
  binder's people get their access through org teams, and Gitea reports
  `"none"` for team-derived access on both the team's `permission` and the
  repository's collaborator list. The only honest answer is to ask for the
  repository _as that member_ and read what comes back — which is what the
  step-2 notes said and is now code.
- **Every version per document**, not only the newest. The comparison reads a
  published change against the version _below_ the one it became; against
  today's record it would be comparing it with itself. `listDocumentVersions`
  was already being called per document for `nextVersion`, so the whole list
  costs nothing.

`resolveComparisonBase` now takes `{ name, version }[]` rather than `DocTag[]`:
named and numbered is all it reads, and a binder's per-document tags carry no
common created date.

`?view=preview` and `?view=compare` join `?tab=` and `?change=` in the query,
for the same reason all of them are there. The discussion carries no `view`, so
a change's own link stays short.

**A test flake fixed rather than retried.** `approveChange` confirmed an
approval was standing and the merge then failed with "does not have enough
approvals" — because Gitea processes a push asynchronously and can dismiss an
approval a moment after it reads as good. The helper now requires it to stand
on two checks a beat apart, which is what makes the answer mean anything.

### History and Settings finish the binder's shape

The two tabs the shell was missing.

**History** is ADR 0004's own sentence made into a page: "who approved v4 of
infection control is answered by tag → commit → pull request → reviews. The
record is exact." Two calls for the whole binder — the tags, and the closed
changes — joined on the merge commit each tag points at. Every row names the
document, the version, when, the change that published it, who submitted it,
and everyone whose approval **stood** at the time; a stale or dismissed review
is not a sign-off and is not counted. A tag written outside Bindersnap says so
rather than inventing a change to point at.

`DocumentVersion` gained `publishedAt`, which was already on the tag Gitea
returns and was being thrown away.

**Settings** shows who can act in the binder and what has to be true before a
policy changes. The people come from the teams _granted onto the repository_
(`GET /repos/{owner}/{repo}/teams`), not from the organization's team list
filtered by name: the ADR's direction is that teams belong to the organization
and a binder adopts them, so a customer's own committee granted onto two
binders is the shape to expect, and only the repository knows which teams reach
it.

The rules are said in sentences rather than as a settings form read backwards,
with the product's core claim first — "nothing reaches the record except a
change that has been approved and published" — and **both sides of every rule
stated**, because a rule that is off is still a rule the customer chose. The
approval count is read with the service account: how many approvals a change
needs is policy every reviewer is entitled to, and Gitea shows the rule only to
a repository admin. The whitelists are not sent to the browser.

`RepoBranchProtection` gained `enablePush`, so the core claim can be shown
rather than only asserted.

**The Owners team is easy to get wrong, and this page got it wrong first.**
Gitea reports the organization's built-in Owners team as `repo.code: "owner"`
on every repository the org holds — a level above `admin` that
`describeTeamAccess` did not know, so the page rendered **"No access" beside
the person who owns the organization**. That is precisely what the ADR warns
about: "Counting by name suffix would miss the Owners team, whose members have
write access to every repository in the org." `ACCESS_ORDER` in `orgs.ts` had
ranked `owner` highest all along; only the wording was short. Pinned in both a
unit test and an integration test.

Editing is not built. The page says so in a sentence rather than by drawing
controls that do nothing.

### The organization has people, and a binder stops manufacturing teams

Piece 1 of the org-access design, and it changes provisioning in two ways.

**A binder creates no teams.** In Gitea a team is an _organization_ object that
a repository adopts, so three per binder inverted the model: it manufactured
objects nobody asked for — two of which stay empty forever — and it made a
recurring group un-reusable, because a Quality Committee reviewing three
binders became three membership lists a human keeps in step by hand. A binder's
access is now exactly what has been granted onto it, and the per-binder team
survives only as a lazy fallback for the first _individual_ grant.

**The organization has a `staff` team**, created with it, holding the reviewer
unit map — read on `repo.code`, `repo.pulls` and `repo.issues`. That is not a
coincidence: it _is_ the reviewer permission, held once for the organization
instead of once per binder, which is what makes "four hundred nurses can read
the manual" one call rather than four hundred per binder. It costs no seats,
because a seat is write or better on `repo.code`.

`includes_all_repositories` is deliberately **false**. With it true every binder
is readable by everyone forever with no way back, an HR-investigation binder
becomes impossible, and the only remedy is a second organization — which breaks
billing. False makes granting `staff` a per-binder act, so the product gets a
switch instead of a law. A new binder grants it, because open is the decided
default.

**The approvals whitelist is the part that fails silently, and it now has
tests.** `enable_approvals_whitelist` is what makes a free reviewer's approval
count; the cost is that the list must name every team whose members may
approve, or their approvals are recorded, displayed, and satisfy nothing.
`recomputeApprovalsWhitelist` derives it from `GET /repos/{owner}/{repo}/teams`
— and appends **`Owners` unconditionally**, because Gitea gives that team admin
over the whole organization implicitly and never grants it onto a repository.
A list derived from the granted teams alone omits it and an **owner's** approval
stops counting, presenting as "publishing is mysteriously blocked".

Two integration tests pin exactly that: an owner in no other team approves and
the change publishes, and a member of `staff` does the same. They are the two
claims the design flagged as reasoned rather than tested.

**The organization page has tabs now** — Binders and People — laid out like the
binder for the same reason. People reads teams-first: the members, the teams,
and each team's membership, a bounded number of calls. The per-user permission
endpoint is not used and must not be: team access granted per unit lands in a
field it never reads, so it answers `none` for a member who can push. That is
defect 8 one layer down, and it has bitten twice.

`staff` is left off each person's group list, because a group everybody is in
says nothing and crowds out the ones that do.

**Two things this broke, both correctly.** `addApprover` in the integration
tests joined `<binder>-reviewers`, which no longer exists — it joins `staff`,
which is where a binder's reviewers now come from. And the dev seed still
creates its own role teams, so it now rewrites the approvals whitelist after
granting them; without that its own publishes would fail with "does not have
enough approvals" beside a green tick.

Editing is still not built. Both pages say so in a sentence rather than drawing
controls that do nothing.

### Groups are named once and composed everywhere

Piece 2 of the org-access design, and the first piece that lets a customer
change who can do what without opening Gitea.

**A group is a name and a level together**, because a Gitea team carries one
unit map: `PUT /teams/{id}/repos/{org}/{repo}` adopts a team at whatever
permission it already has, and there is no per-grant level. So "Quality
Committee" cannot be an editor in one binder and a reviewer in another — if a
customer needs that, it is two groups. A form that asked for the two separately
would imply otherwise, and a UI offering a level per binder is a UI that will
have to refuse. The level therefore travels with the name everywhere it appears,
and the constraint is stated on the page rather than discovered on a binder.

The three levels are the three role unit maps, reused rather than restated:
`ROLE_TEAM_OPTIONS` is the definition `tests/gitea-permission-model.pw.ts`
already pins, and a second one here would drift the way the seed's once did.
Only the words differ, and only where the Gitea word is actively misleading —
**Admin** stays Admin, and **Editor** replaces "author" because an author is a
claim about who _wrote_ something, and "Author: Priya" on a policy Priya never
touched is a false attribution on a product whose output is evidence.

**The stored name is a handle, and the name on screen is derived from it.**
A group is written into `.gitea/CODEOWNERS` as `@org/group`, which Gitea parses
by splitting on whitespace, so "Quality Committee" could never be named in a
sign-off rule. `slugifyGroupName` makes it `quality-committee` and the create
form shows that before the button is pressed; `describeGroupName` says it back
as "Quality Committee" wherever it is shown. Derived rather than stored beside
it, because a second copy is a table shadowing a Gitea object — the thing ADR
0004 refuses — and it would disagree the first time somebody renamed the team.
Gitea's own spelling is left alone, so `Owners` stays `Owners` rather than
becoming a second team by a second name.

**Every grant and revoke recomputes the approvals whitelist in the same
handler**, because that half fails silently: `enable_approvals_whitelist` is
what makes a free reviewer's approval count, and a granted team missing from the
list has its members' approvals recorded, displayed, and satisfying nothing.
Recomputed rather than appended to, so a revoke narrows the list by the same
code path a grant widens it — a whitelist that only grew would leave a removed
group's approvals counting after the access that justified them was taken away.
Verified in both directions against the live Gitea, and pinned by two
integration tests: a member of a granted group approves and the change
publishes, and revoking takes the group off `approvals_whitelist_teams`.

**A grant is read and written from both ends**, which the design's API table
asked for and the first cut of this missed. A binder's Settings tab answers "who
can act here"; a group's own row answers "which binders does this reach" — the
same grant seen from either side, and `GET /teams/{id}/repos` is the mirror of
`GET /repos/{owner}/{repo}/teams`. The second is not a convenience: it is the
question that decides whether changing a group is safe, because its level and
its membership land on every binder in that list at once, and the row says so
once the list has more than one entry. Both ends write through the same two
endpoints, so there is one grant path rather than two.

A group in no binder is called out rather than left blank — it grants nothing
anywhere, and that is the difference between a group somebody set up and one
somebody only named.

**`Owners` is in the list and in neither act.** `GET /repos/{owner}/{repo}/teams`
does report it — checked on the running stack — but it is never granted onto a
repository, so adding it is offering something already true and removing it is
offering something that cannot happen. The API refuses both with a sentence, and
the page draws no control, because a control that has to refuse is worse than no
control.

Who may do any of this is Gitea's answer rather than ours. Creating a group is
`POST /orgs/{org}/teams`, guarded by organization ownership; granting one is
guarded by admin on the repository. `canManage` decides which buttons are drawn
and nothing else — an app-side check standing in for a permission question is
the tripwire ADR 0004 names.

Worth knowing for piece 3: Gitea's `/teams/{id}/repos/...` routes sit behind
`reqTeamMembership()`, so a **binder admin who is neither an org owner nor a
member of the group cannot grant it**, even though `AddTeamRepository` itself
only asks for repository admin. It cannot bite today — every binder is created
by an org owner — and it arrives the same day `can_create_org_repo` is handed
out, which is the day the bootstrap correction in the design has to ship too.

### A stale approval was being counted as an approval

Found while chasing a test that had been intermittently failing at the _publish_
after checking it had an approval, and it is a product defect rather than a test
one. `countApprovals` has always skipped stale reviews, because Gitea does at
merge time — an approval overtaken by a new upload is not a signature on the
version being published. `resolveApprovalState` did not, so `approvalState` read
`approved` beside an approval count of zero: the change page offered a publish
that Gitea then refused with "does not have enough approvals", and Home
classified the change as ready.

That is the same shape as the `isRejected` defect above — two rules in the
codebase answering one question, one of them wrong — and it is the shape to keep
looking for.

The fix is deliberately **not symmetrical**: a stale _approval_ stops counting,
a stale _request for changes_ still blocks. `dismiss_stale_approvals` dismisses
approvals on a push and leaves rejections standing, so Gitea blocks on a stale
rejection too, and showing it as cleared would be the one error that lets
something reach the record.

### A binder has a People tab, and one person at a time can be moved

Piece 3 of the org-access design. Groups made the recurring case cheap; this is
the one-off — "add Priya to this binder as a reviewer" — and the refusal that
makes the group constraint honest.

**One row per person.** A matrix loses because the roles are a ladder Gitea
enforces as one: a grid of checkboxes would let somebody try "can approve but
cannot read", which is not a thing and the screen would have to refuse it.
Grouping by role loses because it answers "who are the editors" when the
question a compliance manager asks is "what can Jane do" — which one row answers
by being read. The read model is teams-first and bounded: the teams granted
here, then each team's membership, folded to the highest access per person. The
per-user permission endpoint is not used and must not be.

**The role team is made on first use.** Provisioning creates none, so a binder
that only ever adopts groups never manufactures one, and an organization with
twenty binders and three recurring groups holds five to eight teams rather than
sixty-two. `ROLE_TEAM_OPTIONS` is unchanged; only the moment it is used has
moved.

**A role that comes from a group is refused, and the refusal names the group.**
That group is one object across every binder it is granted onto, so changing
somebody's role on this row would change it everywhere the group reaches. The
row shows the group instead of a dropdown that would have to refuse — and the
consolation is that "why can she approve here" is answered on the row that
raised the question. The escape hatch is an _addition_: one member of a group
needing more in this one binder is granted individually, alongside the group
rather than instead of it.

Removal is the same rule. Taking somebody out only touches this binder's own
role teams; if a group is the only thing holding them here, the button would
have to reach into that group and change three other binders, so it is refused
with the cost stated.

**Who can act here moved off Settings.** The binder's tab bar is now Documents ·
Change requests · People · History · Settings, which is where the UX document
puts it — and a page that lists people is a page somebody expects to be able to
edit. Settings keeps the rules, which are still read-only and say so.

`Seat` or `Free` is on every row with a running count above the list, because
"reviewers are free" is a promise somebody comes to this page to check. The
price of a change is stated before it is made; the amount waits for billing.

### `staff` was granted everywhere and empty

The defect this piece turned up, and it is the quiet kind. `staff` is what
"everyone at Riverside Health can read this binder" is made of — provisioning
creates it, opens every new binder to it, and whitelists it. **Nothing ever put
anybody in it.**

Nothing looked broken, because everybody who was in an organization was also in
`Owners` or in some role team, and reached binders that way. It would have
surfaced the first time somebody was added to one binder and then could not see
another that was open to the whole organization — with no screen able to say
why.

So every path that admits somebody to the organization now goes through
`ensureOrganizationMembership`, which puts them in `staff` first: adding a
person to a binder, adding one to a group, and creating the organization
(its founder was not in it either). Before the grant that prompted it, so a
failure leaves them a member who can read the open binders — the Member rung,
and a safe place to stop.

Leaving is deliberately not the mirror. Taking somebody out of a binder or a
group leaves them in the organization, which is why removing a person from an
open binder now correctly leaves them able to read it, through `staff`. Leaving
the organization is its own act, with its own confirmation, and it is piece 4.

### Who can see this binder is a question, asked once

The switch ADR 0004 §1.2 asks for, and it is one primitive: `staff` granted onto
the repository, or not. **Nothing is stored** — the answer is derived by asking
Gitea which teams are granted here, because a stored copy could disagree with
the grant Gitea is the one enforcing, and the one that matters is the one Gitea
enforced.

**It is asked at creation, with "Everyone at …" preselected.** The moment
somebody is naming a binder is the moment they know whether it is the staff
handbook or HR investigations, and that is far cheaper than discovering a week
later that an investigations binder was readable by the whole company. Open is
the default because the common case is a manual everybody must be able to read
in order to attest to it — a default, not an assumption, which is why the
question is on the form rather than in the code.

**It is its own endpoint, not a group grant with a friendlier name.** The two
are different acts to the person doing them: "everyone at Riverside Health can
read this" is a decision about the binder, and "add the Quality Committee" is a
decision about a group. Routing the first through the second puts a team called
`staff` in a picker beside the customer's own committees — which is exactly what
the first cut of this did, and it was visible immediately: opening a binder made
a row called **Staff** appear under "Groups with access" with its own _Remove
from this binder_ button, duplicating the switch six inches above it and making
the most consequential access choice in the product look like housekeeping.

So `staff` is now filtered out of every list that presents groups — the binder's
and the organization's. It is the organization's membership, not a group
somebody composes, and its only control is each binder's own switch. The
whitelist recompute still reads the unfiltered set, so nothing about enforcement
changed.

The cost of opening is stated on the option rather than discovered afterwards:
read on `repo.pulls` is what approving is, so everyone at the organization can
also approve there. For an internal policy manual that is right — it is the same
conclusion ADR 0004 reached for reviewers — and where it is wrong, the other
option is the answer. It costs no seats either way.

Three integration tests: closing and reopening a binder, with the whitelist
narrowing and widening to match; a restricted binder created that way staying
invisible to a member who was not added, while an open binder beside it stays
readable by the same person; and the switch refusing a request that does not say
which way.

### An organization's people can be promoted, demoted and removed

Piece 4, and the last of the access model that does not need an invitation.

**Two rungs, and only two.** An owner is a member of Gitea's built-in `Owners`
team, so promoting is one `addTeamMember` and demoting is one
`removeTeamMember`. Nothing is stored, and billing keeps reading the team it
always read. Every third org-level role anyone proposes turns out to be a binder
role wearing a costume — "compliance lead" is a manager of the binders they run,
"auditor" is a reviewer on everything — and a rung above the binder is the
expensive kind: org-wide, invisible from the binder it affects, and not
something Gitea will enforce for us.

**The last-owner rule is one check, not two.** Demoting the last owner and
removing them are different requests with the same consequence — an organization
nobody can administer and no way back that does not involve us — so
`refuseLastOwner` serves both and they say the same sentence. Two checks would
eventually disagree, and the half that drifted would be the one nobody tested.
On screen the control is disabled with the reason _in place of_ a tooltip:
nobody reads a tooltip and no keyboard reaches one.

**Removal is native and leaves nothing to reconcile.** `DELETE
/orgs/{org}/members/{username}` takes them out of the organization and every
team in it in one call — there is no table of ours to clean up, which is the
same reason ADR 0004 gives for keeping permissions in Gitea rather than
shadowing them.

**And what stays is the point.** The confirmation says it, and it is the most
important string on the page:

> They lose access immediately, everywhere. Everything they wrote, approved or
> commented on stays exactly where it is — that record is yours, not theirs.

The fear behind "can I remove someone" in a regulated industry is that the
record leaves with them; it is the fifth thing ADR 0004 lists as broken about
the old model, and removal is the moment to answer it. An integration test
proves the sentence rather than trusting it: a reviewer approves a change, it
publishes, they are removed, the binder answers **404** for them — and their
approval is still named against v1 in the binder's history.

Promoting gets a confirmation because it hands over the keys. Removing gets one
because it cannot be undone by pressing the same control again. Demoting gets
neither: it is one call and reversible, and a dialog would imply a weight it
does not have.

**No "remove" on your own row.** Leaving an organization is a different act from
removing somebody else and deserves its own wording; offered here as "Remove
Alice" it reads like an accident waiting to happen. The API stays permissive and
Gitea stays the enforcer — this is a decision about what to draw, not a rule we
invented.

### The paywall stops hiding the record

Piece 10 of the org-access design. Independent of every other piece, which is
why it went now rather than in order.

ADR 0004 is structural about the paywall: it gates authoring and mutation and
**never** gates reading or exporting, because holding a customer's approval
history hostage is the one act that would poison a compliance reference
permanently. #392 made that true of the API. It was not true of the app — a
lapsed subscription replaced the whole SPA with the card form, so the record
the rule exists to keep open was the one thing a delinquent customer could not
reach, and nobody could exercise the rule end to end.

**The 402 is typed now, and that is the part that was quietly fragile.**
Whether a 402 was the paywall talking was decided by matching the request
path, because `GET /api/app/billing` answers 402 with a whole billing status
when an organization is delinquent — data, not a refusal. So every new billing
route had to remember to add itself to a list in `paymentRequired.ts`, and one
that forgot would put the app into read-only mode from the very page that
exists to get out of it. `code: "subscription_required"` states the
distinction instead of inferring it, and carries the organization's name,
because a person who belongs to two of them learns nothing from "your
subscription has lapsed".

**Three cases are deliberately not read-only**, each with a test saying why:

- **No organization.** Nothing has lapsed and there is nothing to buy.
  Authoring asks for an organization, which `handlePaymentRequired` already
  did and still does.
- **A billing status we could not fetch.** This reverses the old behaviour,
  which bounced them to `/billing`. Refusing a paying customer's controls
  because Stripe was briefly unreachable is the worse failure, and it is not a
  risk: the API is the gate, so a write that should be refused still is, and
  its typed 402 turns read-only on for real.
- **A trial.** It reads as `active` through `resolveSubscriptionStatus`.
  Getting this wrong would put every new customer into read-only for their
  first fortnight.

**Read-only folds into the flag each surface already has** — `canManage` on the
two People tabs, `decision` on the publish and approve bar — rather than
sitting beside it. Every control on those surfaces is already conditional on
that one flag, and a second condition threaded through the same call sites is
a second thing to forget. They are different questions with the same
consequence: draw nothing.

Worth being explicit, because it looks like the thing the ADR forbids: this is
**not** an app-side check standing in for a permission question. Permission is
Gitea's answer and arrives on the payload. Read-only is a billing state, which
is ours to know, and it applies to everyone in the organization including its
owners — the org is delinquent, not the person.

The banner is persistent and not dismissable, because the controls it explains
are not drawn: somebody whose publish button has vanished has nowhere else to
look. It leads with what still works and says nothing has been taken away. A
customer who reads "account suspended" will assume their approval history is
gone, which is the impression the ADR spends a paragraph forbidding.

The same fold reaches the discussion composer (`canParticipate`) and the
reviewer picker (`canManage`, folded inside `ChangeReviewers` so its two
callers cannot disagree). Commenting is a mutation and the API refuses it for a
delinquent org, so drawing the composer was an invitation to type a comment and
lose it to a 402.

Not folded in: mutating controls in the per-document workspace, which leaves
with the old model. The API refuses them regardless, so the failure mode there
is an error rather than a silent write.

**Pinned against a real stack.** `tests/read-only-mode.pw.ts` signs a member
up, gives them an organization and a binder, revokes the organization's access
the way an administrator would, and asserts both halves of the promise: the
binder still renders with its heading and its documents endpoint still answers
200, while the banner appears, "Add a policy" is gone, and creating a binder is
refused with a typed 402 naming the organization. It also asserts the URL did
not move, because being sent to `/billing` is exactly the behaviour this
replaced.

`admin_revoke` is the route in rather than a lapsed Stripe subscription: it is
the top of `resolveAccess`'s precedence list, so it reaches the same state, and
it needs no Stripe credentials — which the integration environment does not
always have. The test was checked by breaking `resolveReadOnly` and watching it
fail, so it is known to be testing something.

**Two controls were missed until somebody looked at the screen**, and both were
outside every component the feature had touched — which is why reading the diff
twice did not find them. The top nav's "New document" button sits on _every_
page, so it was the one unusable affordance a delinquent customer met wherever
they went. And the binder's empty state read "Nothing filed here yet. Add a
policy and it joins the binder once the change is approved" — instructions for
a button no longer on the page.

The lesson generalises past this feature: a mode that removes controls cannot
be verified by looking at the components that implement it, because its bugs
are exactly the controls nobody remembered belong to it. Screenshot the running
app.

### Per-folder sign-off, and the escaping bug underneath it

Pieces 11 and 12, and the reason the Gitea 28.0.0 upgrade was worth taking.

**A sign-off rule names a group, and that is the whole point.** Before
`block_on_codeowner_reviews`, a `.gitea/CODEOWNERS` rule had to name
individuals — a team code owner blocks nothing, because Gitea writes a team
review request and then clears its own `official` flag. So every personnel
change became a pull request in every binder naming that person, approved by
the very code owners the file was being edited to change. For a compliance
manager with twenty binders that is not a workflow, it is an outage. Now the
rule names a group and changing who is in that group is one Gitea call:
instant, no commit, no approval, nothing stale.

**Changing the rules is an approved change, and the screen says so.** `main` is
protected, so the regenerated file goes onto a branch and opens a change like
any other, and the endpoint returns a **change number rather than a success** —
a caller holding a number cannot report otherwise. Gitea reads CODEOWNERS from
the base branch, so the rules already in force govern the change to them, which
is the right authority and costs nothing. A customer buying "nothing changes
without approval" who discovered the approval rules could be changed silently
would have found the hole in the product.

**One open sign-off change at a time.** Two would leave competing versions of
the rules in review and whichever published last would silently win, with no
screen able to say the other had been overwritten.

#### The escaping is doubled, and one layer of it was missing from the design

The design said folder names must be regex-escaped. That is half of it, and the
half that does not work alone.

`TokenizeCodeOwnersLine` runs **before** `ParseCodeOwnersLine` compiles
anything, and it **consumes backslashes** — `\x` becomes a bare `x` — as well
as splitting on spaces and truncating at an unescaped `#`. So a backslash
written to escape a regex metacharacter never reaches the regex. A folder called
`Q1 (2026)`, escaped once, is written `Q1 \(2026\)/.*`: the space splits the
line, the pattern becomes `Q1`, and everything after it is read as an owner.
Escaped once without the space, `(2026)` would still arrive at the regex as a
**capture group**.

So escaping is regex-escape first, then tokenizer-escape the result —
`escapeRegex` then `escapeForTokenizer`, composed only by `codeownersToken`.
`packages/utils/codeowners.ts` carries a faithful port of Gitea's tokenizer so
that every assertion about matching runs through what Gitea will actually
compile; checking the raw line passes exactly this class of bug.

#### What the generator owes, and why

Verified against a running Gitea 28.0.0 on 2026-09-08: **a CODEOWNERS pattern
that does not compile is dropped with a log warning, not refused.**
`GetCodeOwnersFromContent` returns `(rules, warnings)`, logs the warnings, and
leaves the bad line out; the gate then finds no matching rule and passes. A file
where every rule is malformed leaves the gate wide open while every screen says
sign-off is required — the `parseReviewSettings` failure mode ADR 0004
complains about, inside Gitea's own parser.

Since **we** generate the file, that is a bug of ours that lands as a control
which quietly stops controlling. `validateSignOffRules` therefore refuses,
before a single Gitea call:

- a pattern that does not compile **as Gitea will see it**, after tokenizing;
- a pattern that compiles but does not match its own folder, or that also
  matches a sibling — the check that catches an escaping bug, which mere
  compilation does not;
- a rule naming a group the organization does not have, which can never be
  satisfied and would leave the binder unable to publish;
- a rule with nobody on it, and two rules over one folder;
- a file over a conservative size ceiling, far below the 8 MiB at which Gitea
  fails closed.

#### The capability is read back, never inferred

Dev runs a 28.0.0 nightly and production runs 1.27.3, which accepts
`block_on_codeowner_reviews` on a write and **silently drops it**. So
`protectWorkspaceMain` writes the field and reads the protection back to see
what stuck. A version string cannot answer this — not least because the 28.0.0
binary self-reports `1.28.0+dev`.

`block_on_official_review_requests` is switched off **only** once the new gate
is confirmed. Turning it off unconditionally would remove the only per-folder
enforcement a 1.27 binder has and put nothing in its place. And the probe fails
safe: the protection is already written when it runs, so a read that fails
answers "assume not supported" and leaves the older gate on.

#### Three things this turned up in code that already existed

- **Publishing refused a change that touches no document.** Correct for every
  other change — one that versions nothing is a mistake — and wrong for a
  sign-off change, which versions nothing by design. Told apart by the branch,
  the same way an upload is. A sign-off branch is deliberately **not** under
  `upload/`, because `documentSlugPathFromUploadBranch` would read it as a
  document and the binder would list a policy that does not exist.
- **The change page claimed "becomes v1 when published"** on a change that
  publishes no version, and drew a document panel with every control disabled.
  `DocumentChangeDetail` now takes an optional `subject`, and a binder's change
  page passes one when the change touches no document. That string is exactly
  the kind of thing a compliance customer notices.
- **A change's title came from its whole body.** `parseChangeTitle` returned the
  entire trimmed body, which was fine while every body was one line and made the
  sign-off change's explanation into the page's `<h2>`. It takes the first line
  now and `describeSubmission` takes the rest — a one-line body behaves exactly
  as before, and a body with detail finally renders as a title plus a
  description.

The seed sets `block_on_codeowner_reviews` too, so a seeded binder demonstrates
the feature instead of opening its Sign-off rules tab with a warning. That is a
**third** copy of the binder's branch protection — the app's and the permission
model test's are the others — and copies of one rule are what this codebase
keeps catching mid-drift. It stays separate only because the seed talks to Gitea
directly with no app running.

### The old model is deleted

ADR 0004 migration step 2's last sentence, and the largest single deletion in
the series: **20,000 lines out, 2,300 in.** No compatibility window — decision 3
from 2026-09-04 — so the one-repo-per-document endpoints go outright rather than
deprecated.

Gone: `createPrivateCurrentUserRepo` and the whole upload path built on it, the
sixteen `documents/:owner/:repo` route matchers and every handler only they
reached, the per-document workspace in the SPA (`DocumentDetail`,
`DocumentPermissions`, `DocumentCollaborators`, `DocumentAccess`,
`DocumentHistory`, `CreateDocumentModal`, `UploadModal`), and the `/docs/:owner/:repo`
route with it.

**What could not simply be deleted was the library, and it is the interesting
part.** Home already worked — `searchInvolvedChanges` asks Gitea about pull
requests, and a binder is a repository, so its changes were always in the
answer. The library was not: it searched Gitea for _repositories_, because a
document was one.

So it is rebuilt on binders, and it lost most of its questions doing so. The
saved views — "contributing", "owned", "everything" — and the filter by person
were all questions about who owned a repo. Nobody owns a document now: the
organization owns the binder and the binder holds the policy, and everyone who
can see a binder sees everything in it. Those chips had nothing left to mean, so
they are gone rather than reinterpreted into something that would quietly mean
something else. What is left is the question the page is actually opened with —
"where is that policy" — narrowed by the one thing that does distinguish
policies: which binder they are in.

**Three Gitea calls per binder, not per document**, which is the property the
binder model bought and the only reason a cross-organization library is
affordable: five binders and four hundred policies is fifteen calls, where the
old shape paid roughly three per document. It is unpaged for the same reason —
the server reads each binder once, so there is no cheaper page to fetch, and
asking for page two would repeat the whole read. Quick find runs through the
same reader with a cap, so the two cannot disagree about which binders count.

**`ChangeScope` collapsed.** It was a two-variant union introduced so one set of
review screens could serve both models; with one model left it is a plain
interface, and `api.ts` lost a dozen branches that always took the same side.

#### Two things that would have gone silently

**The regulator export was about to be deleted with the page that reached it.**
`auditRecord.ts` builds the self-contained HTML file that answers a surveyor —
the product's own claim — and its only caller was the old document's History
tab. Deleting it would have removed a stated feature with no error anywhere. It
is now a **binder's** record instead of one document's, which is the better
shape anyway: a regulator asking for "your infection control policies" got one
file per policy before, and gets one file per binder now.

**Anonymous document viewing is gone, and that is a real loss to name.** An
unauthenticated visitor hitting a document URL used to get the document shell,
served by the service account — but only for a **public** repository.
`resolveDocumentAccess` refused a private one, and a binder is private by
design, so the path had nothing left to serve. It is deleted rather than ported.
ADR 0004 already makes #364's one-time links the way an external reviewer gets
in, and this is the moment that stopped being a nice-to-have.

#### The approvals whitelist on a change page: verified unreachable, not built

The last item in "What is left" asked for a computed "your account is not
authorized to approve this" on the binder change payload. It should not be
built, and the reason is worth recording so it is not proposed again.

`recomputeApprovalsWhitelist` derives the list from the teams granted onto the
repository plus `Owners`, and every path into a binder goes through one of those
teams. The one shape that could produce an unauthorized approver is a **direct
repository collaborator** — and with the old model deleted, `addRepoCollaborator`
has no caller at all: the only route that used it was
`documents/:owner/:repo/collaborators`. A binder's people are teams, always. So
the state the screen would explain cannot be reached, and a screen for an
unreachable state is a screen that will be wrong the first time it is right.

### The config branch is retired, and the policy is stamped on the event

ADR 0004's migration step 5, both halves.

**`blockOnUnresolvedThreads` is a table row now.** The committed
`.bindersnap/config.json` on a `bindersnap-config` branch paid every cost the
ADR lists for putting configuration in git — a network round trip per read, two
to four API calls plus permanent objects per write, a branch that existed only
because `main` is protected — and bought one property: a commit recording who
changed the policy and when. That property is kept as `settings_events`,
append-only and indexed, and the costs are not.

The cost worth naming on its own is the third one: the file had no types and no
constraints, so `parseReviewSettings` had to tolerate a malformed one — and it
degraded **silently to the permissive policy**. A corrupt byte turned a control
off and said nothing. That is the same failure the Gitea 28.0.0 verification
found inside Gitea's own CODEOWNERS parser, and it is the reason this is a
typed table rather than a tidier file.

Keyed on the Gitea repository id, because Gitea renames repositories and a name
key breaks silently when it does — the same reasoning as `organizations`.

**The policy in force is stamped into each version's annotated tag.** ADR 0004:
"when configuration shapes what happened, do not version the configuration —
stamp it onto the event." So publishing writes approvals required, everyone
whose approval **stood**, whether unresolved discussions blocked publishing,
whether per-folder sign-off was enforced, who published, and which change it
came from — into the tag. Immutable, attached to the exact event, no join
against historical settings, and readable from a bare clone with no application
and no database running.

Three details that are decisions rather than formatting:

- **Both sides of every rule.** A stamp that listed only the rules that were on
  would be silent about the ones that were not, which is the same ambiguity as
  no stamp at all.
- **An unreadable approval count says "unknown", not "0".** Branch protection is
  admin-only, so the service account can fail to read it — and "0" is a claim
  that no approvals were required, which is a very different statement.
- **The approvers are read after the merge**, because the approvals that count
  are the ones that stood when Gitea accepted it. One dismissed on the way in is
  not a signature on what was published.

**Changing the thread rule is immediate; changing a sign-off rule is not**, and
Settings says so. A sign-off rule decides who has to approve a change, so
changing it goes through the same approval a policy does. The thread rule gates
nobody out and changes no permission, so making an administrator open a change
to tick a checkbox would be ceremony without a reason. Both are recorded.

**PATCH was not in the API's CORS allow-list**, because no route had used it.
The browser refused the preflight and the request never left — which surfaces
as "Failed to fetch" with **nothing in the API's log**, because the API never
saw it. Worth knowing before the next verb is added.

### Version numbers were being read the old model's way

Three defects of one shape, found while deciding whether the
`document_versions` index was worth building. All three are the binder
migration leaving a version read pointed at the shape that is gone.

**Gitea's tag list is paged, and the defaults are small.** Measured against the
dev stack on 2026-09-08 with a repository of sixty tags:

| Request     | Tags returned |
| ----------- | ------------- |
| no params   | 30            |
| `limit=100` | **50**        |
| `limit=50`  | 50            |

`listVersionsByDocument` sent no parameters at all, so it saw thirty.
`listDocTags` asked for a hundred and silently got fifty — `MaxResponseItems`
caps it. Neither said anything about the rest.

A binder's tags are its **version history**, so truncating them is not a display
bug. Thirty versions is ten documents at v3. Past that, the History tab — the
compliance record, the thing a surveyor is shown — would quietly stop listing
versions that exist, and `nextVersionFrom` would compute a next version that had
already been used. `listAllTags` follows the pagination, and an integration test
writes sixty-five tags and asserts all sixty-five come back. Checked by
reverting the fix: it returns thirty.

This is the same defect the notes already record about the document list — "the
unpaged read asked Gitea for a hardcoded 100 and silently dropped anything past
it" — at a different endpoint. Worth looking for a third.

**Home said "becomes v1" for every change.** `getLatestDocTag` matches
`doc/v0001`, the _old model's_ tag format; a binder writes
`nursing/infection-control/v3`. So `latestTag` was always null, `nextVersionOf`
was always `0 + 1`, and Home told everybody their change would publish v1
however many versions the document already had. A version number is the one
thing this product cannot be casually wrong about.

The version is now on the **change**, not the binder — a binder holds many
documents with their own versions, so one number for the binder is a claim about
none of them. Read from the change's `upload/<slugPath>/…` branch against one
tags read per binder, which Home was already paying for.

**And Home named the binder where it meant the document.** `document.repo` is
the binder now, so a row about the infection control policy said "Clinical". The
change carries which document it is about; the binder's name is the fallback for
a change that is about none — a sign-off rules change, for instance.

### The `document_versions` index: measured, and not built

The last item on ADR 0004's list, and the answer is not to build it yet.

The ADR wanted it because tags are repo-global: "a 200-policy binder with twenty
versions each is four thousand tags, eighty paginated calls, on a page load."
That was the cost under one-repo-per-document. The binder model already removed
it — `listVersionsByDocument` reads a binder's tags once rather than once per
document — which is why the notes had already downgraded this from a rescue to
an optimization.

Measured on the dev stack: the cross-binder library answers in **~400 ms for 12
binders and 29 documents**, about 33 ms per binder, at three Gitea calls each.

So the case for building it now is speed nobody has complained about, and the
cost is a second source of truth with a webhook consumer, a reconciler and a
rebuild job — under three conditions the ADR sets precisely because that shape
is dangerous. The ADR's own rule settles it: **the index serves browsing; Gitea
serves proving.** Nothing that gates a decision may depend on it, so it can only
ever buy latency — and there is no latency problem to buy off yet.

What the investigation _did_ find was the three correctness bugs above, which an
index would have papered over rather than fixed: a stale row and a truncated
read look identical from the page.

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

## The URL scheme, and why the organization is in the path

Addresses are the ones Gitea and GitHub use, because a person moving between
Bindersnap and Gitea should see the same address twice:

```
/{org}                       what this organization owns
/{org}/{binder}              the binder's documents, by folder
/{org}/{binder}/{path}       one document

GET  /api/app/binders                                   every binder I can act in
GET  /api/app/orgs/{org}/binders                        one organization's binders
POST /api/app/orgs/{org}/binders                        create one
GET  /api/app/binders/{org}/{binder}/documents          list
GET  /api/app/binders/{org}/{binder}/documents/{path}   one document
POST /api/app/binders/{org}/{binder}/documents          upload
POST /api/app/binders/{org}/{binder}/changes/{n}/publish
```

**The organization is in the path because it cannot be inferred.** The first
cut had `/api/app/workspaces/{binder}/…` and asked
`resolveSessionOrganization` which organization the caller meant — and that
function picks the oldest. A person in two organizations opening a URL for one
could be served the other's binder of the same name. Naming it removes the
guess, and authorization gets simpler rather than harder: these handlers act
with the caller's own token, so a binder they cannot see answers 404 from Gitea
without a membership check to write or keep in step.

Two listings, deliberately, because they answer different questions.
`GET /api/app/binders` is a question about a person — everything I can act in,
wherever it lives — and is what the personal views are built on.
`GET /api/app/orgs/{org}/binders` is a question about an organization. Both are
needed; collapsing them is what left the app with no organization view at all.

**Reserved first segments** make the bare `/{org}` address possible:
`activity`, `admin`, `auth`, `billing`, `docs`, `documents`, `login`,
`organizations`, `signup` (`RESERVED_FIRST_SEGMENTS`, `apps/app/routes.ts`).
Anything added there must also be refused as an organization name, or
somebody's binder becomes unreachable.

## Defects found while getting this green

Each cost a CI round or more and is worth not rediscovering. The first four are
from the billing series; the rest are from step 2.

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

5. **A new binder was not empty.** `createWorkspaceRepo` passes
   `auto_init: true`, which is how `main` comes to exist so it can be protected
   — and it writes a `README.md`. Once documents were files, the read side
   listed that README as a policy called "README". `bootstrapEmptyMainBranch`
   now strips it at provision time, before protection goes on.

6. **Merging a binder change fell into a single-document rescue.**
   `mergeOrResolveConflicts` attempts a merge only when `pr.mergeable !== false`
   and otherwise rebases and re-applies _the_ document file — valid when a
   repository holds one document, impossible in a binder. Gitea computes
   `mergeable` asynchronously, so a just-created, just-approved change commonly
   reads `false`: the merge was never attempted, and the rescue then failed with
   "Could not find document file on head branch", which is not what went wrong.
   `mergeWorkspaceChange` (`services/api/gitea-client/pullRequests.ts`) goes
   straight to the merge, retries the states Gitea describes as transient under
   either 405 or 409 ("please try again later", "does not have enough
   approvals", "is being checked"), and **keeps Gitea's own message** — the
   invented one sent three rounds of debugging after the wrong cause.

7. **Approvals are dismissed as stale, and it is a race.** A binder protects
   `main` with `dismiss_stale_approvals`, and Gitea processes a push
   asynchronously — so an approval submitted moments after a commit lands is
   recorded against the old head and then dismissed (`stale: true`,
   `dismissed: true`), leaving the merge to fail with "Does not have enough
   approvals" and no visible reason. The behaviour is correct and worth keeping.
   Tests approve in a loop until the review actually stands
   (`approveChange`, `tests/workspace-provisioning.pw.ts`); anything else
   driving a publish needs the same.

8. **Seeded role teams had no permission at all.** The seed sent Gitea `units`,
   which it ignores in favour of `units_map`, so every team came out
   `permission: none` — members of a binder who could not touch it. `orgs.ts`
   now exports `ROLE_TEAM_OPTIONS` and the seed uses the app's own definition
   rather than a second copy. Note that Gitea reports a team's own `permission`
   as `"none"` whenever its access is per-unit, and the repo _collaborator_
   endpoint answers `"none"` for team-derived access — so neither is a way to
   check a member's access. Ask the repository as that member and read
   `permissions.push`.

9. **Two documents could claim one address.** `nursing/policy.md` and
   `nursing/policy.pdf` both answered to `nursing/policy`, so a link resolved to
   whichever the tree listed first — and worse, version tags key on the same
   identity, so publishing one wrote the other's `nursing/policy/v1`. The
   identity drops the extension on purpose (re-uploading a policy as a PDF
   should keep its history), so the fix is exclusivity, not putting the
   extension back. Uploads refuse a taken address, **including one claimed by an
   unpublished change** — `main` holds only published documents, so checking the
   tree alone let two uploads race; the upload branch (`upload/<slugPath>/…`)
   carries the identity, which is what `findPendingDocumentBranch` reads.

Also added: `tests/global-teardown.ts` saves the API container log to
`test-results/api.log` before the stack goes down and prints its error lines
into the job output. Defect 1 was invisible without it, because provisioning is
best-effort and swallowed the cause.

## Verified against Gitea 1.27.3

The 1.26 → 1.27.3 upgrade (#387) landed mid-series. Provisioning passes on it
unchanged. #389's CODEOWNERS finding was a reading of 1.26 source and is being
re-checked separately on `claude/reverify-codeowners-gitea-1273`.

## Decisions taken (2026-09-03/04)

Settled with the product owner during the step-2 series. Do not reopen without
asking.

1. **No document backfill.** There are no real customers, so existing
   user-owned document repositories are abandoned rather than replayed. #402 is
   closed. ADR 0004 migration step 3 is dropped — the amendment is recorded in
   the ADR itself.
2. **The seed is the fresh start.** It builds `riverside-health` with two
   binders rather than ten user-owned repositories.
3. **No compatibility window.** With nothing to migrate, the old
   one-repo-per-document endpoints get deleted outright rather than deprecated.
4. **URL renames and redirects are deferred.** `/{org}/{binder}/{path}` is built
   on three names, any of which Gitea can rename under a link somebody already
   sent. GitHub solves this with permanent redirects. Explicitly "much later
   down the road" — do not build it, and do not open an issue for it.
5. **A binder you cannot see answers 404, not 403.** It is the same answer a
   binder that does not exist gives, which is the only one that does not
   disclose which it was.
6. **Personal views stay cross-organization; organization views are scoped.**
   "What is waiting on me" and "what do I own" span every organization a person
   belongs to. "What does this organization have" does not.

## What is left

In rough dependency order.

1. **Invitations.** The one piece of the access model Gitea cannot do at all:
   there is no `POST /orgs/{org}/members` and no way to hold a pending
   invitation, so it is a SQLite table, four routes, an email, and acceptance
   bound to the invited address rather than to the link. Everything before it
   assumes the person already has an account.
2. ~~**Delete the old model.**~~ **Done 2026-09-08** — see "The old model is
   deleted" above. The library moved onto binders in the same change, as this
   note warned it had to.
3. ~~**The `document_versions` derived index.**~~ **Measured and deliberately
   not built** — see "The `document_versions` index: measured, and not built"
   above. The investigation turned up three real version-reading bugs instead,
   which are fixed.
4. ~~**Per-workspace settings and `settings_events`.**~~ **Done 2026-09-08** —
   see "The config branch is retired, and the policy is stamped on the event"
   above.
5. ~~**CODEOWNERS generation.**~~ **Built 2026-09-08**, with the Gitea 28.0.0
   upgrade it was blocked on — see "Per-folder sign-off, and the escaping bug
   underneath it" above. Rules name groups, changing them is an approved
   change, and the generator refuses a file that would enforce nothing.
6. ~~**The approvals whitelist on a binder change.**~~ **Not building it** —
   the state it would explain is unreachable now that the old model is gone.
   The reasoning is under "The approvals whitelist on a change page" above. The
   original note, kept because it is the analysis that led there: `branchProtection` is
   passed as null, so the page never says "your account is not authorized to
   approve this". Gitea still refuses, and the required count is shown — but
   the reason is the admin-only half of the rule and the binder page does not
   ask for it yet.

   **Not the one-line fix it looks like.** `canUserReview` tests
   `approvalsWhitelistUsernames`, and a binder's whitelist is
   `approvals_whitelist_teams` — the usernames list is empty, so passing the
   protection through would answer "allowed" for everybody and say nothing.
   The question is whether the caller belongs to a whitelisted team, which
   only the server can answer, and the whitelists must not be sent to the
   browser (Settings already declines to, deliberately). So this is a computed
   boolean and reason on the change-detail payload, not a prop the page
   forgot to pass.

   Worth knowing before starting: it may be near-empty in practice.
   `recomputeApprovalsWhitelist` derives the list from the teams granted onto
   the repository plus `Owners`, and a member reaches a binder through exactly
   those teams — so anyone who can see the binder is normally already
   authorized. The case it would catch is a direct collaborator, or a grant
   that skipped the recompute, which every grant path now does in the same
   handler. Check whether a real customer can reach the state before building
   the screen for it.

## Working on this locally — two traps

**Integration tests cannot be pointed at a locally built API.**
`tests/global-setup.ts` sets `process.env.BUN_PUBLIC_API_BASE_URL` to the proxy
in front of the `api` container, overriding anything passed in. So an API change
is only exercisable after the container is rebuilt, and until then CI is the
only loop. Running `bun services/api/server.ts` on a spare port against the
running Gitea works for hand-testing with `curl` — that is how defects 6, 7 and
9 were found — but Playwright will not use it.

Rebuilding is `bun run down && bun run up`, and `down` is
`docker compose down -v`, which deletes the volumes and every seeded account
with them. `docker compose up -d --build api` rebuilds only the API and
preserves volumes.

**The shared dev stack accumulates debris that changes behaviour.** After a run
of the integration suites it holds `bs-adr4-*` organizations that every seeded
user is a member of. `resolveSessionOrganization` picks the _oldest_
organization, so the app resolves `alice` to test debris rather than to
`riverside-health`, and the seeded binders appear to be missing. Twenty
`mercy-health-N` organizations also exhaust `MAX_NAME_ATTEMPTS`, after which any
test creating an organization called "Mercy Health" fails with a 502. A full
`down && up` clears both. The seed deliberately uses `riverside-health` so it
does not squat on the name several suites create on purpose.

## Three product decisions, answered

Raised in the PR bodies and answered by the product owner on 2026-09-04. The
reasoning for each is in
[the completion plan](../design/adr4-completion-plan.md), which is where the
rest of the decisions live; they are repeated here because this file is what a
reader of the series has open.

1. **Signup funnel — no card, 14-day trial, land in the binder.** #369's
   no-card trial won over the old signup → `/billing` redirect, which #393 had
   already stopped doing.
2. **Read-only mode for delinquent orgs — build it.** Built; see "The paywall
   stops hiding the record" above.
3. **Do org owners cost a billable seat — yes.** As `listBillableSeats`
   already counts them. A pricing decision rather than a naming accident, so
   the counting stays as it is.
