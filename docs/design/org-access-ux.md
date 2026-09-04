# Organizations, people and permissions — the screens

Companion to [`org-access-architecture.md`](./org-access-architecture.md), which is
the same design seen from the API. Continues
[`workspace-redesign-spec.md`](./workspace-redesign-spec.md) and inherits every
cross-cutting rule in it — one coral element per screen, green for approval only,
no `owner/repo` paths, no git icons in user-facing chrome, meta lines that say one
thing.

Status: proposed. Nothing here is built.

## The person on the other side of every screen

A compliance or operations manager at a healthcare organization. Non-technical.
They have never heard of a pull request, a repository, a code owner, or a branch,
and they never will — the app already softens git vocabulary and this document
extends that softening to organizations, teams and permissions.

They think in five nouns: **the organization, binders, folders, policies, and who
signs off.** Every string below survives being read cold by that person. Where a
word in the codebase would not survive, it stays in the codebase and a different
word goes on screen; §4.1 lists the translations.

---

## 1. Yes, a sidebar — but only inside an organization

The owner asked directly, so here is the argument rather than a preference.

**Against a sidebar:** the approved redesign pins a top nav on every page and
deliberately made Home task-first — every row is a change waiting on you, never a
document link. A permanent list of binders down the left competes with that: it
invites browsing on a page whose whole thesis is that you should not have to
browse. It also costs the full width that the change-review timeline was designed
against, and on a phone it becomes a drawer nobody opens.

**For a sidebar:** the model now has four levels and the top nav can address two of
them. Today the organization page is reachable only through a menu in the avatar
area — a customer's own organization is a hidden route in their own product. And
the binder is where the work now lives: a compliance manager moving between
Clinical Policies and HR twenty times a day should not go through a menu each time.

**The decision, and the reason it is not a compromise:** the sidebar appears on
organization-scoped routes and nowhere else.

| Route                                  | Chrome                   |
| -------------------------------------- | ------------------------ |
| `/` Home                               | Top nav only, full width |
| `/documents`, search                   | Top nav only, full width |
| `/{org}`                               | Top nav **+ sidebar**    |
| `/{org}/{binder}`                      | Top nav **+ sidebar**    |
| `/{org}/{binder}/{path}`               | Top nav **+ sidebar**    |
| `/billing`, `/organizations/new`, auth | Top nav only             |

ADR 0004 already decided that personal views span every organization and
organization views are scoped to one. That is currently an invisible rule people
have to be told. The sidebar makes it a thing you can see: **when the sidebar is
there, you are inside one organization; when it is gone, you are looking across all
of them.** The chrome teaches the model, which is the only kind of navigation
argument worth winning.

It also costs the approved redesign nothing, because none of the screens the
redesign specifies — Home, Documents, the document workspace, change review — is an
organization-scoped route. The document workspace is reached today at
`/docs/:owner/:repo` and keeps its full width; when it moves under
`/{org}/{binder}/{path}` it gains the sidebar, and the four-tab layout inside it is
untouched.

### The sidebar itself

```
┌──────────────────────────┐
│ Riverside Health      ⌄  │  ← org switcher; ⌄ lists other orgs + "New organization"
├──────────────────────────┤
│ BINDERS                  │  mono 11px label, --bs-text-faint
│   Clinical Policies      │
│ ▸ HR                  2  │  ← count = changes waiting on YOU in that binder
│   Infection Control      │
│   + New binder           │  ← dashed affordance, admins only
├──────────────────────────┤
│   People              12 │
│   Sign-off rules         │
│   Settings               │
│   Billing                │  ← owners only; absent entirely otherwise
└──────────────────────────┘
```

- **248px**, `--bs-surface-2` against the page's `--bs-page-bg`, hairline
  `--bs-rule-warm` on the right edge. No shadow — it is part of the paper, not
  floating on it.
- **Under 1100px** it collapses to a 56px icon rail; the binder list becomes
  initials with the name on hover. **Under 768px** it is gone, and a breadcrumb
  under the top nav takes over: `Riverside Health › Clinical Policies`, each
  segment tappable.
- The count beside a binder is **changes waiting on you there**, not total changes.
  A number that is not about you is noise, and this is the one place a badge earns
  its coral.
- **Billing is absent, not disabled,** for a non-owner. A disabled row is an
  invitation to ask why; an absent row is a product that does not concern them.

The top nav is unchanged from the approved spec, sitting above the sidebar at full
width: logo, Home, Documents, spacer, search, coral **New document**, bell, avatar.
The org switcher moves out of the avatar menu and into the sidebar's head, where it
belongs.

---

## 2. The organization page — `/{org}`

Today: a heading, a create-binder form, a list. It reads like a settings page for
something that has not started yet.

What a compliance manager needs when they land here is the answer to "is my
organization in good shape" — not a form. Three sections, in this order.

```
Riverside Health                                       [ New binder ]

  ── Binders ─────────────────────────────────────────────────────
  Clinical Policies      48 policies · 3 changes open · Everyone
  HR                     12 policies · no open changes · 6 people
  Infection Control       9 policies · 1 change open  · Everyone
  + New binder

  ── People ──────────────────────────── 12 people · 4 seats · 8 free
  MO  Maya Okonkwo    Owner      Nursing        Seat
  JT  Jack Truong     Member     Quality        Seat
  PR  Priya Raman     Member     Nursing        Free
  … and 9 more                                     Manage people →

  ── Your subscription ──────────────────────────── owners only
  Team plan · 4 seats · renews 14 Oct           Manage billing →
```

- The binder row's third fact is **who can see it** — "Everyone" or a count — because
  that is the question a compliance manager is asked in an audit and cannot
  currently answer from any screen.
- The people section is a **preview, not a manager**. Five rows and a link. The
  organization page's job is "is this in good shape"; the managing happens on its
  own page where the destructive controls live behind their own confirmations.
- The seat line — `12 people · 4 seats · 8 free` — is on the page's most-read
  section on purpose. §6 explains why it lives here rather than only in billing.
- **One coral element:** `New binder`. Everything else is a ghost button or a link.

**Empty state**, an organization with no binders yet:

> **Nothing in here yet.**
> A binder holds a set of policies that the same people approve the same way.
> Most teams start with one — call it what you call it out loud.
> `[ Create your first binder ]`

That last line is doing real work. Naming the first container is the moment a
customer decides whether this product matches how they already think, and "call it
what you call it out loud" is permission to not use our vocabulary.

---

## 3. The binder page — `/{org}/{binder}`

The binder is where the work is. Folders, policies, and — one click away — its
rules and its people.

```
Clinical Policies                                  [ Add a policy ]
48 policies · 2 approvals to publish · Everyone at Riverside Health

  Documents   Changes 3   People 14   Sign-off rules   Settings

  📁 Nursing                        12 policies   Infection Control signs off
  📁 Pharmacy                        8 policies   Pharmacy Committee signs off
  📁 Emergency                       6 policies   —
     Hand hygiene            v4 · Current · updated 2h ago
     Patient handover        v2 · In review · Needs your review
```

- **Folders are rows, not a tree.** They are directories, they nest, and a tree
  control for three levels is a control nobody asked for. Clicking a folder goes
  into it; the breadcrumb comes back out. Depth is the customer's business.
- **A folder row shows who signs off on it.** This is the single most valuable
  thing the new Gitea capability makes visible, and burying it in a settings tab
  would waste it. `—` means the binder's normal approvers, which is honest and
  needs no explanation.
- The header's second line is the binder's rules in plain words: how many approvals
  and who can see it. Not a settings link — the actual answer.
- **"Waiting on me in this binder" is not a section here.** Home already answers
  "what is waiting on me", across every organization, and duplicating it per binder
  gives a person two inboxes that disagree. The binder surfaces it exactly once, as
  a status pill on the row (`Needs your review`) and as the count in the sidebar.

---

## 4. Permissions

The heart of it, and the part most likely to be got wrong by shipping the
vocabulary we happen to have in the code.

### 4.1 What these are called

The teams are `<binder>-admins`, `<binder>-authors`, `<binder>-reviewers` in Gitea
and stay that way. On screen they are:

| Gitea team  | On screen    | The one line under it                                |
| ----------- | ------------ | ---------------------------------------------------- |
| `admins`    | **Manager**  | Runs this binder: its rules, its people, its folders |
| `authors`   | **Editor**   | Writes policies and publishes approved versions      |
| `reviewers` | **Reviewer** | Reads, comments, approves or asks for changes. Free  |

**Why not "Admin".** In a hospital, "admin" is a job title in the front office and,
to everyone else, the person who resets passwords. It names IT, not authority over
a policy manual. "Manager" is what this person already is.

**Why not "Author".** An author is the person who _wrote_ something — a claim about
history. This role is about who may write _next_, which is a different fact, and a
compliance manager reading "Author: Priya" would reasonably conclude Priya drafted
the policy. "Editor" carries no such claim and is the exact word Word and Google
Docs already taught this customer.

**Reviewer survives** because it is right and because the free tier depends on it
being understood without a footnote.

Org-level: **Owner** and **Member**, matching Gitea exactly, because those two words
are already correct and the switcher, the invitation email and the billing page all
have to use the same one.

### 4.2 One person, one row — not a matrix

```
People in Clinical Policies                     [ Add someone ]
14 people · 3 seats · 11 free

Who can see this binder?   ● Everyone at Riverside Health   ○ Only people I add

MO   Maya Okonkwo      Nursing        Manager  ⌄     Seat
JT   Jack Truong       Quality        Editor   ⌄     Seat
PR   Priya Raman       Nursing        Reviewer ⌄     Free
DL   Dan Levitt        Pharmacy       Reviewer ⌄     Free    ⋯
```

**A matrix loses** because it implies the roles are independent capabilities you
can mix. They are not — they are a ladder, and Gitea enforces them as one. A grid of
checkboxes would let somebody try "can approve but cannot read", which is not a
thing, and the screen would have to refuse it, which is worse than never offering
it.

**Grouping by role loses** because it answers the wrong question. Grouped, the page
answers "who are the editors"; a compliance manager asks "what can Jane do", and
answering that means scanning three lists and hoping she is in only one. One row
per person answers it by looking at one line.

**A role is a dropdown, not a modal.** Changing it is one Gitea call, it is
reversible, and putting it behind a dialog implies a weight it does not have. The
destructive action — removing someone — is behind the `⋯` and gets its confirmation
(§5).

**The visibility switch sits above the list**, because it changes what the list
means. When it is "Everyone at Riverside Health", the list stops being the whole
answer and the page says so directly under it:

> Everyone at Riverside Health can read this binder and comment on changes.
> The people below can do more.

### 4.3 Making "reviewers are free" land

Two places, and neither is the pricing page.

**A chip on every row.** `Seat` or `Free`, mono 11px, `--bs-surface-2` fill — quiet,
because it is a fact, not a status. Over the list, the running count:
`14 people · 3 seats · 11 free`.

**At the moment of the change, inline, before it happens.** Changing Priya from
Reviewer to Editor drops a line under her row:

> Editors use a seat. This takes Riverside Health to 4 seats — **$X more per
> month**, from your next invoice. `[ Make Priya an editor ]` · Cancel

A bill that changes should change in front of the person changing it. The
alternative is discovering it a month later, which is the "which version did we
approve" of billing — the same category of unpleasant surprise this product exists
to eliminate.

And going the other way is worth saying out loud too, because it is the tier's whole
pitch:

> Reviewers are free, always. Add as many as you like.

### 4.4 Sign-off rules — CODEOWNERS, without the file

The customer will never see `.gitea/CODEOWNERS` and will never hear the phrase
"code owner". They see a page of sentences.

```
Sign-off rules — Clinical Policies

Every change needs  [ 2 ⌄ ]  approvals before it can be published.

Some folders need a specific group as well:

  Nursing        must be signed off by   Infection Control  ⌄   ⋯
  Pharmacy       must be signed off by   Pharmacy Committee ⌄   ⋯
  + Add a rule

☑  Every comment must be resolved before publishing
```

- **The rule is a sentence.** "Nursing must be signed off by Infection Control."
  There is no pattern, no path syntax, no file. The folder picker lists the binder's
  actual folders; the group picker lists the organization's groups and its people.
- **A group, not a list of names.** This is what the Gitea upgrade buys, and the
  screen should spend it: when somebody leaves Infection Control, no rule changes,
  no approval is needed, nothing goes stale. Changing who is _in_ Infection Control
  happens on the People page and takes effect immediately.
- **Changing a rule is an approved change, and we say so plainly.** Saving does not
  save:

  > **This change needs approval.**
  > Changing who signs off is itself a change to the binder — so it goes through the
  > same approval your policies do. We've opened it for you.
  > `[ Review the change ]` · It's called "Update sign-off rules".

  This is the opportunity, not the wart. A customer who is buying "nothing changes
  without approval" and then discovers the approval rules can be changed silently
  has found the hole in the product. Showing them the hole is closed, at the exact
  moment they would wonder, is worth more than the click it costs. The change appears
  in the Changes tab like any other, titled in their language.

- **Immediate vs approved, made visible.** The approvals count and the comment
  checkbox save instantly; the folder rules open a change. Same page, two behaviours,
  so the page has to say which is which. The folder section carries a quiet line:
  _Changes to these rules are approved like a policy._

### 4.5 When someone cannot see something

A binder a person cannot see answers 404, not 403 — the same answer a binder that
does not exist gives, which is the only answer that does not disclose which it was.
The page must not undo that in copy.

> **We can't find that binder.**
> It may have been renamed, or it may not be shared with you.
> If you think you should have access, ask an owner of Riverside Health.
> `[ Back to Riverside Health ]`

"It may not be shared with you" is doing careful work: it is true whether or not the
binder exists, so it discloses nothing, and it tells a person who _should_ have
access exactly what to do. Never "you don't have permission" — that confirms it is
there.

---

## 5. Adding, removing and promoting

### Inviting

Lives on the org's People page. Gitea has no invitation of its own, so this is
entirely ours — which means it is also entirely ours to make gentle.

```
Invite someone to Riverside Health

  Email      [ priya@riverside.health          ]
  Role       ( ) Owner — can manage people, binders and billing
             (•) Member — access is set per binder
  Add to     [ Clinical Policies ⌄ ]  as  [ Reviewer ⌄ ]     (optional)

  [ Send invitation ]
```

> We'll email them a link. Nothing changes on your bill until they accept — and
> reviewers are always free.

**The optional binder line is the whole reason invites work.** An invitation that
only grants org membership lands someone in a product with nothing in it. Inviting
them straight into a binder as a reviewer means the first thing they see is a
policy waiting for them.

Pending invitations sit under the people list, greyed, with `Resend` and `Revoke`:

```
PENDING
  priya@riverside.health    Reviewer in Clinical Policies · sent 2d ago   Resend · Revoke
```

### Promoting to owner

The role dropdown on the org People page. It gets a confirmation, because it is the
one change that hands over the keys:

> **Make Jack Truong an owner?**
> Owners can add and remove anyone, create and delete binders, and manage billing.
> `[ Make Jack an owner ]` · Cancel

### Removing

Behind `⋯`, and the copy is the product's argument:

> **Remove Priya Raman from Riverside Health?**
> They lose access immediately, everywhere.
> Everything they wrote, approved or commented on stays exactly where it is —
> that record is yours, not theirs.
> `[ Remove Priya ]` · Cancel

That second paragraph is the single most important string in this document. The
fear behind "can I remove someone" in a regulated industry is that the record leaves
with them — it is the fifth thing ADR 0004 lists as broken about the old model. The
moment of removal is the moment to answer it, and answering it turns an
administrative chore into a demonstration of the thing they are paying for.

### The last owner

Disabled, with the reason in place of a tooltip:

> Riverside Health needs at least one owner. Make someone else an owner first.

Both routes — removing the last owner and demoting them — hit the same rule and say
the same sentence.

---

## 6. Billing

### Who sees it

Owners see `Billing` in the sidebar and the subscription section on the org page.
**Members see neither** — absent, not disabled. If a member reaches `/billing`
directly:

> **Only owners can manage billing for Riverside Health.**
> Maya Okonkwo and Jack Truong can. `[ Back to Riverside Health ]`

Naming the owners turns a dead end into the next step.

### Seats, explained where they are created

Seats are derived from who can write, so the honest place to explain them is where
write access is granted — §4.3's inline line — not a monthly invoice. The billing
page's job is only to show the arithmetic:

```
Team plan · $X per editor per month
4 seats             Maya, Jack, Sam, Priya
0 for reviewers     11 people review for free
Renews 14 October                            [ Manage billing ]
```

`0 for reviewers` is a line item that costs nothing to render and states the pitch
as an accounting fact.

### The trial

A quiet strip in the sidebar's foot, coral only in its last three days:

> 9 days left in your trial · `Add a payment method`

No modal, no interstitial, no countdown on the document pages. A trial that
interrupts work is a trial that teaches the customer what the product feels like
when they are being billed at.

### Read-only mode

When an organization's subscription lapses, the app today redirects to `/billing`,
which hides a customer's own records behind a bill. The API has been right about
this since #392; the SPA is telling a lie about it. What it should do:

A banner under the top nav, on every page, `--bs-status-warn-bg` with
`--bs-status-warn-border` — warn, never danger, because nothing has gone wrong with
their records:

> **Riverside Health's subscription ended on 12 March.** You can still read, search
> and export everything — that never stops. To publish new versions again, update
> the payment method. `[ Manage billing ]`

For a member, the last sentence becomes: _Ask Maya Okonkwo or Jack Truong to update
it._

And every mutating control — `New document`, `Add a policy`, `Submit new version`,
`Approve`, `New binder`, the role dropdowns — is disabled, each with the same short
reason on hover: _Paused until the subscription is renewed._

**Reading, searching, opening a version, and exporting are never disabled.** Not
dimmed, not gated, not behind a "trial ended" wall. The banner says so in its second
sentence because a customer in this state is exactly the customer deciding whether
we can be trusted with their records, and it is the cheapest promise we will ever
keep.

---

## 7. Build order

One branch and one PR each, in dependency order. Only piece 5 needs Gitea 28.0.0.

| #   | PR                        | Screens                                                                                                                                                                | Needs 28.0.0 |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | **Shell: the sidebar**    | Sidebar on org-scoped routes only; org switcher moves into it; the responsive rail and the phone breadcrumb. No new data                                               | no           |
| 2   | **The organization page** | Binders / People preview / Subscription; the empty state; the seat line                                                                                                | no           |
| 3   | **The binder page**       | Folder rows with their sign-off group; the header's plain-words rules line; the tab bar                                                                                | no           |
| 4   | **People**                | Org and binder people pages; role dropdowns; the visibility switch; seat and free chips; the inline seat-change line; invite, remove, promote, and the last-owner rule | no           |
| 5   | **Sign-off rules**        | The rules page; folder rule sentences; group picker; the "this change needs approval" hand-off into the Changes tab                                                    | **yes**      |
| 6   | **Read-only mode**        | The banner, the disabled controls, the never-disabled reads; replaces the `/billing` redirect                                                                          | no           |

Pieces 1–3 are presentation over endpoints that already exist or are trivial. Piece
4 is the largest and may split — invite and pending state is a clean seam. Piece 6
is independent of all of them and could ship first if the delinquent-org question
gets urgent.

---

## 8. Copy deck

Every user-visible string specified above, collected for review on its own.

**Sidebar**

- `BINDERS` · `+ New binder` · `People` · `Sign-off rules` · `Settings` · `Billing`
- `9 days left in your trial` · `Add a payment method`

**Organization page**

- `48 policies · 3 changes open · Everyone`
- `12 people · 4 seats · 8 free` · `Manage people →` · `Manage billing →`
- Empty: **Nothing in here yet.** / A binder holds a set of policies that the same
  people approve the same way. / Most teams start with one — call it what you call
  it out loud. / `Create your first binder`

**Binder page**

- `48 policies · 2 approvals to publish · Everyone at Riverside Health`
- `Infection Control signs off` · `Add a policy`
- Tabs: `Documents` `Changes` `People` `Sign-off rules` `Settings`

**Roles**

- `Manager` — Runs this binder: its rules, its people, its folders
- `Editor` — Writes policies and publishes approved versions
- `Reviewer` — Reads, comments, approves or asks for changes. Free
- `Owner` — can manage people, binders and billing
- `Member` — access is set per binder

**People page**

- `Who can see this binder?` · `Everyone at Riverside Health` · `Only people I add`
- Everyone at Riverside Health can read this binder and comment on changes. / The
  people below can do more.
- `Seat` · `Free` · `14 people · 3 seats · 11 free`
- Editors use a seat. This takes Riverside Health to 4 seats — **$X more per month**,
  from your next invoice.
- Reviewers are free, always. Add as many as you like.

**Invite**

- `Invite someone to Riverside Health` · `Send invitation`
- We'll email them a link. Nothing changes on your bill until they accept — and
  reviewers are always free.
- `Resend` · `Revoke` · `Reviewer in Clinical Policies · sent 2d ago`

**Promote**

- **Make Jack Truong an owner?** / Owners can add and remove anyone, create and
  delete binders, and manage billing. / `Make Jack an owner`

**Remove**

- **Remove Priya Raman from Riverside Health?** / They lose access immediately,
  everywhere. / Everything they wrote, approved or commented on stays exactly where
  it is — that record is yours, not theirs. / `Remove Priya`

**Last owner**

- Riverside Health needs at least one owner. Make someone else an owner first.

**Sign-off rules**

- Every change needs `2` approvals before it can be published.
- Some folders need a specific group as well:
- `Nursing` must be signed off by `Infection Control` · `+ Add a rule`
- ☑ Every comment must be resolved before publishing
- Changes to these rules are approved like a policy.
- **This change needs approval.** / Changing who signs off is itself a change to the
  binder — so it goes through the same approval your policies do. We've opened it
  for you. / `Review the change` / It's called "Update sign-off rules".

**Not found**

- **We can't find that binder.** / It may have been renamed, or it may not be shared
  with you. / If you think you should have access, ask an owner of Riverside Health.
  / `Back to Riverside Health`

**Billing**

- **Only owners can manage billing for Riverside Health.** / Maya Okonkwo and Jack
  Truong can.
- `Team plan · $X per editor per month` · `4 seats` · `0 for reviewers` ·
  `11 people review for free` · `Renews 14 October` · `Manage billing`

**Read-only**

- **Riverside Health's subscription ended on 12 March.** You can still read, search
  and export everything — that never stops. To publish new versions again, update
  the payment method. / `Manage billing`
- Member variant: Ask Maya Okonkwo or Jack Truong to update it.
- Disabled control hover: Paused until the subscription is renewed.

---

## 9. What the API must answer that it cannot today

Listed for the architecture document, which specifies all of them:

| Screen needs                                               | Endpoint                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A binder row's "who can see it"                            | `GET .../binders/{org}/{binder}/people` — whether `staff` is granted                |
| A person's role in a binder, for the whole list at once    | The teams-first read model; the per-user endpoint reports `none` and cannot be used |
| A folder row's sign-off group                              | `GET .../binders/{org}/{binder}/rules` — parsed CODEOWNERS                          |
| Seat and free chips, and the running count                 | Derived from the same read model plus `listBillableSeats`                           |
| The inline "this takes you to 4 seats" line                | The seat count must be computable _before_ the role change is made                  |
| Pending invitations                                        | `GET .../orgs/{org}/invitations` — no Gitea equivalent exists                       |
| The read-only banner's reason and whether to show a button | The typed 402 body and `canManageBilling` on billing status                         |
| Naming the owners in "ask an owner"                        | `listOrganizationOwners`, already exported                                          |

The last one is the smallest and the most easily forgotten: three different screens
name the organization's owners in their copy, so that list has to be available
outside the people page.
