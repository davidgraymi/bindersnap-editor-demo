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

## 1. No sidebar. A breadcrumb that switches, and tabs inside a scope

This section previously recommended a sidebar on organization-scoped routes. The
owner pushed back on it — "don't do it just because I suggested it" — and the
push-back is right. The reversal, and the reason, because a reversed
recommendation is worth more than a quiet deletion.

**What killed it is a fact about the pages, not a matter of taste.** The binder
page in §3 has a tab bar — Documents, Changes, People, Sign-off rules, Settings —
and the document workspace already has one from the approved redesign. Add a
sidebar and an organization route carries **three** levels of navigation chrome
stacked on one screen: top nav, sidebar, tabs. Every one of them is a list of
places to go, and the user has to learn which list owns which kind of destination.
That is the cost, and no amount of good sidebar design pays it off.

Three more, in descending order of how much they should have mattered the first
time:

- **The binder count is small.** A customer has two to six binders, not sixty. A
  permanent 248px column is a lot of screen to spend saving one click on a list of
  four things — and the organization page _is_ that list, better presented.
- **Chrome that appears and disappears is not a lesson, it is a jump.** The
  original argument was that the sidebar's presence teaches the personal-versus-
  organization scoping rule. Nobody learns a data model from a panel that comes and
  goes; they notice the page moved sideways. That argument was a rationalization.
- **It contradicts the approved redesign's own thesis.** Home is task-first on
  purpose: every row is a change waiting on you, never a document link. A permanent
  list of binders down the left is an invitation to browse, on a product whose
  claim is that you should not have to.

**What replaces it, and what the sidebar was actually solving.** Two real
problems, both solvable without a panel:

_Problem one: the organization is a hidden route in the customer's own product._
It is reachable today only through a menu in the avatar area. **Fix: a breadcrumb
in the top nav, and every segment is a switcher.**

```
 [logo]  Riverside Health ⌄ › Clinical Policies ⌄ › Nursing        [search]  [+ New]  🔔  (MO)
```

- The **org segment** opens the organization switcher — other organizations, and
  "New organization". This is where the switcher moves from the avatar menu.
- The **binder segment** opens the binder list for this organization, plus "New
  binder" for anyone who may create one. This is the twenty-times-a-day switch the
  sidebar existed for, and it costs a click on a menu that is already under the
  pointer instead of 248px on every page.
- The **folder segments** are plain navigation, no menu.
- Clicking a segment's _text_ goes there; clicking its `⌄` opens the menu. Two
  affordances, one row.
- **Below 768px** the breadcrumb keeps only the last two segments and the org
  segment collapses to its initials. Nothing else changes, which is the point — a
  breadcrumb degrades, a sidebar has to be reinvented as a drawer.

_Problem two: People, Sign-off rules, Settings and Billing have nowhere to live._
**Fix: they are tabs on the scope that owns them**, which is where a customer will
look for them anyway.

| Scope        | Route                    | Tabs                                                     |
| ------------ | ------------------------ | -------------------------------------------------------- |
| Organization | `/{org}`                 | Binders · People · Settings · Billing _(owners only)_    |
| Binder       | `/{org}/{binder}`        | Documents · Changes · People · Sign-off rules · Settings |
| Document     | `/{org}/{binder}/{path}` | Overview · Changes · History · Access _(unchanged)_      |

Three scopes, one pattern: **the breadcrumb moves you between scopes, the tabs move
you within one.** That is a rule a person can hold, and it is the rule the document
workspace already taught them.

**Billing is absent, not disabled,** for a non-owner — a disabled tab is an
invitation to ask why, an absent one is a product that does not concern them. The
same holds for every owner-only control in this document.

The top nav is otherwise unchanged from the approved spec: logo, breadcrumb,
spacer, search, coral **New document**, bell, avatar. Home and Documents move into
the logo's left group; they are still one click from everywhere.

**What is genuinely lost:** the per-binder "waiting on you" count the sidebar
carried. It moves to the binder switcher menu, where the number sits beside the
binder it belongs to — visible on the switch you were already making, rather than
permanently on a page you were not.

---

## 2. The organization page — `/{org}`

Today: a heading, a create-binder form, a list. It reads like a settings page for
something that has not started yet.

What a compliance manager needs when they land here is the answer to "is my
organization in good shape" — not a form. Three sections, in this order.

```
Riverside Health                                       [ New binder ]

  Binders   People 12   Settings   Billing

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
- The tab bar is §1's second half: **Binders · People · Settings · Billing**, the
  last owners-only and absent otherwise. The sections above live on the Binders
  tab, which is what `/{org}` opens.

**Creating a binder asks two things, not one.** The name, and who can see it:

> **New binder**
> Name `Clinical Policies`
> Who can see it? ● Everyone at Riverside Health ○ Only people I add
> `[ Create binder ]`

Everyone is preselected, because the common case is a policy manual the whole
organization must be able to read. The second field exists because the moment
somebody is naming a binder is the moment they know whether it is the staff
handbook or HR investigations, and it is far cheaper to ask then than to discover
the wrong answer a week later. It is one radio pair and it never needs to be
touched again.

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
  a status pill on the row (`Needs your review`) and as the count beside the binder
  in the breadcrumb's switcher menu.

---

## 4. Permissions

The heart of it, and the part most likely to be got wrong by shipping the
vocabulary we happen to have in the code.

### 4.1 What these are called

The teams are `<binder>-admins`, `<binder>-authors`, `<binder>-reviewers` in Gitea
and stay that way. On screen they are:

| Access level | On screen    | The one line under it                                |
| ------------ | ------------ | ---------------------------------------------------- |
| `admin`      | **Admin**    | Runs this binder: its rules, its people, its folders |
| `write`      | **Editor**   | Writes policies and publishes approved versions      |
| `read`       | **Reviewer** | Reads, comments, approves or asks for changes. Free  |

**Admin, not "Manager".** An earlier draft proposed "Manager" on the grounds that
"admin" reads as IT in a hospital. The owner rejected it, and the rejection is
right: "admin" is already the word in Gitea, in the API and in the code, and
inventing a second word for the same thing means every conversation between a
customer, a support reply and a log line has to be translated. A word that is
merely imperfect beats a word that is unique to us. **Invent vocabulary only where
the underlying word is actively misleading**, which is the whole test, and the next
paragraph is the one case that passes it.

**Editor, not "Author" — the one invented word, and why it earns it.** An author is
the person who _wrote_ something: a claim about history. This role is about who may
write _next_, which is a different fact, and a compliance manager reading
"Author: Priya" on a policy Priya never touched would reasonably conclude she
drafted it. On a product whose output is evidence, a role label that reads as a
false attribution is the one place the cost of inventing a word is lower than the
cost of keeping ours. "Editor" carries no such claim and is the exact word Word and
Google Docs already taught this customer.

If the owner would rather have zero invented words than one, `Author` is a
one-string change and nothing else in this document moves.

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

MO   Maya Okonkwo      Nursing        Admin    ⌄     Seat
JT   Jack Truong       Quality        Editor   ⌄     Seat
PR   Priya Raman       Nursing        Reviewer ⌄     Free
DL   Dan Levitt        Pharmacy       Reviewer ⌄     Free    ⋯

     ── through a group ──────────────────────────────────────
AK   Aisha Kone        Quality        Reviewer · Quality Committee
RS   Ray Santos        Quality        Reviewer · Quality Committee
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

**People who are here through a group get a label, not a dropdown.** This is the
visible face of a real constraint rather than a design choice: a group is one
object across every binder it is granted onto, so changing Aisha's role on this
row would change it in three binders at once. The row therefore names the group
instead of offering a control that would have to refuse, and the `⋯` menu offers
the two things that _are_ true here — "Open Quality Committee" and "Add Aisha
individually as well", the second being the escape hatch when one person in a
group needs more in this one binder.

The consolation is that the answer to "why can Aisha approve here" is on the row
that raised the question, which a dropdown would never have told her manager.

**Groups are managed on the organization, not here.** The binder's People tab has
a second, short section under the list —

```
  Groups with access
  Quality Committee · Reviewer     6 people          Remove from this binder
  Nursing Leads · Editor           4 people          Remove from this binder
  + Add a group
```

— and "Add a group" is a picker of groups that already exist plus a link to create
one on the organization's People tab. Creating a group asks for **a name and a
level in one step**, because a group's level is fixed across every binder it is
granted onto and a form that asked for them separately would imply otherwise.

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

Owners see the `Billing` tab on the organization page and the subscription section
on its Binders tab.
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

A quiet strip under the top nav on organization routes, coral only in its last
three days:

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

| #   | PR                        | Screens                                                                                                                                                                                                                               | Needs 28.0.0 |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | **Shell: the breadcrumb** | Breadcrumb with switchers in the top nav; org switcher moves out of the avatar menu; scope tab bars; the sub-768px collapse. No new data                                                                                              | no           |
| 2   | **The organization page** | Binders / People preview / Subscription; the empty state; the seat line                                                                                                                                                               | no           |
| 3   | **The binder page**       | Folder rows with their sign-off group; the header's plain-words rules line; the tab bar                                                                                                                                               | no           |
| 4   | **People and groups**     | Org and binder people pages; the groups section and its picker; role dropdowns and the group-derived label; the visibility switch; seat and free chips; the inline seat-change line; invite, remove, promote, and the last-owner rule | no           |
| 5   | **Sign-off rules**        | The rules page; folder rule sentences; group picker; the "this change needs approval" hand-off into the Changes tab                                                                                                                   | **yes**      |
| 6   | **Read-only mode**        | The banner, the disabled controls, the never-disabled reads; replaces the `/billing` redirect                                                                                                                                         | no           |

Pieces 1–3 are presentation over endpoints that already exist or are trivial. Piece
4 is the largest and may split — invite and pending state is a clean seam. Piece 6
is independent of all of them and could ship first if the delinquent-org question
gets urgent.

---

## 8. Copy deck

Every user-visible string specified above, collected for review on its own.

**Breadcrumb and tabs**

- `New binder` · `New organization`
- Org tabs: `Binders` `People` `Settings` `Billing`
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

- `Admin` — Runs this binder: its rules, its people, its folders
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
