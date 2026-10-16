# From here to the first paying customer, and then to profit

Written 2026-10-16 against `development/binders-gitea-28`. This replaces the
playbook in #388, which was written in August for a $100 flat price and a
product that billed each reviewer. Its sales method still holds and is
condensed here. Its price, its product gaps and its offer have all changed.

The short version:

1. **You cannot take a dollar today.** Production still runs the old model and
   is wiped when #763 merges. The cutover is the critical path, and three of its
   steps have lead times measured in days. Start those on Monday.
2. **Selling does not wait for the cutover.** Discovery calls need no product.
   Book them now. Demos start the week production is live.
3. **The first five customers are hand-sold to learn, not for revenue.** At
   $39 a writer, a typical customer pays $40–$120 a month. The business is
   profitable only once customers arrive without you on the phone. The first
   customers buy you the words, references and referral partners that make that
   happen.

---

## 1. Where things stand

### What is ready to sell

Everything a first customer needs is built on this branch:

| Need                                       | State                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Billing per organization, reviewers free   | Built. The paywall judges the organization, not the person (#800).                        |
| $39/writer seat price, synced to Stripe    | Built (#729). Terraform for the live price is `infra/billing`, not applied.               |
| "What if you disappear?" — exports         | Built. Any version to PDF or Word, and a per-document audit packet (`exportAuditPacket`). |
| Reading and exporting free after a lapse   | Built, and on the pricing page.                                                           |
| Loading a manual                           | The add dialog takes several files and folders. You still do the first imports yourself.  |
| Invitations, password reset, notifications | Built (#706–#713). They need SES out of the sandbox to reach anyone.                      |
| Terms, Privacy, DPA, subprocessors         | Written. Three placeholders remain and counsel hasn't reviewed it.                        |
| Public site: pricing, `/for`, templates    | Built. It doubles as sales collateral (section 4).                                        |

### What blocks the first dollar

From the #763 checklist, the items that stop you **charging a card or
onboarding a person**. The rest of that list (drift check, Renovate, uptime
Worker) matters, but it doesn't block a sale.

| #   | Step                                                                                                                                                                                   | Lead time    | Why it blocks                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| 1   | Apply `infra/email`, then **request SES production access the same day**                                                                                                               | 1–3 days     | In the sandbox, signup verification and invitations never arrive    |
| 2   | Fill `[STATE]`, `[MAILING ADDRESS]`, `[LEGAL NOTICES EMAIL]` in `apps/legal/documents/{terms,privacy,dpa}.md` (moves `LEGAL_VERSION`), then **send Terms, Privacy and DPA to counsel** | 1–2 weeks    | A buyer's compliance lead reads the DPA. Placeholders end the deal. |
| 3   | Apply `infra/billing-test`, then `infra/billing`. Make the $39 price the default, archive the $90 price, then `put-secrets.sh --rotate` with fresh live keys                           | an afternoon | No live price means no checkout                                     |
| 4   | Apply `infra/edge`, run `put-tunnel-token.sh` and `put-signup-turnstile-secret.sh`, then set `SIGNUP_TURNSTILE_SITE_KEY` on `production`                                               | an afternoon | Without them the API won't start, or production refuses signup      |
| 5   | Email Routing: confirm `privacy@`, `security@`, `team@` and `notifications@` forward                                                                                                   | an hour      | The legal pages promise these addresses                             |
| 6   | Click through on `bun run up --fresh`: sign up → org → binder → document → change request → approve → publish → subscribe → cancel in test mode                                        | an hour      | It is the demo, and it must not break in front of a buyer           |
| 7   | Wipe old prod volumes, apply `infra/compute`, merge #763, set `mail_transport=ses`                                                                                                     | a day        | The cutover itself                                                  |

Two non-code items with lead time, best started the same Monday:

- **Insurance.** Get a quote for tech E&O plus cyber liability. Small
  healthcare buyers increasingly ask for a certificate of insurance. Budget an
  estimated $1,000–2,000 a year, then replace that with a real quote.
- **Stripe account details.** Check that the live account is Solid Gray LLC's,
  with the LLC's bank account, statement descriptor `BINDERSNAP`, and the
  support email and phone you want on receipts.

**Do not demo on today's production, and do not sign anyone up there.** It
runs the previous model, and #763 wipes it. An account a prospect creates this
week is gone next week. Until the cutover, show the product on your local stack
(`bun run up`) by screen share.

---

## 2. The money

### What it costs to run

| Item                                                         | ≈ per month    |
| ------------------------------------------------------------ | -------------- |
| AWS after cutover (`docs/ops/production-architecture.md` §6) | $45            |
| Cloudflare (free plan), Email Routing, R2 at this size       | $0–1           |
| Insurance, E&O plus cyber (estimate, see above)              | $85–170        |
| Domain, LLC upkeep (varies by state)                         | $5–30          |
| **Running total**                                            | **≈ $135–245** |

One-time: counsel's review of the legal pages. Get a fixed-fee quote.

### What a customer pays

Stripe takes roughly 2.9% + $0.30 per card charge plus 0.7% for Billing, so
about **$1.70 on a one-seat invoice**, leaving ≈ $37.30 per writer.

| Customer shape                               | Writers | Monthly | Net after Stripe |
| -------------------------------------------- | ------- | ------- | ---------------- |
| Clinic: one administrator writes, staff read | 1       | $39     | ≈ $37            |
| Home health agency: administrator + DON      | 2       | $78     | ≈ $75            |
| ASC: administrator, DON, quality coordinator | 3       | $117    | ≈ $113           |

Plan on **1.5–2 writers per customer, about $65 a month net**. Reviewers are
free by design, so customers will name one writer and many reviewers. Count on
it and don't fight it. Free reviewers are why the medical director says yes.

### The three milestones

| Milestone                                                 | Writer seats | Customers (≈ 1.75 writers each) |
| --------------------------------------------------------- | ------------ | ------------------------------- |
| **Covers hosting** (~$45)                                 | 2            | 1–2                             |
| **Covers all running costs** (~$245, the high estimate)   | 7            | 4                               |
| **Pays one founder $5,000/month** on top of running costs | ~140         | ~80                             |

The first two come from hand-selling. The third can't: 80 customers at one
discovery call, one demo and one hand import each is a year of nothing but
phone calls for about $900 of yearly revenue per customer. So the plan has two
phases:

- **Phase 1, customers 1–5: hand-sold.** The goal is learning, references and
  two referral partners. Revenue is a side effect.
- **Phase 2, customers 6–80: arrive without a call.** They come through
  accreditation consultants, the public site, and word of mouth inside
  accreditor networks. You get there by turning what Phase 1 taught you into
  copy, templates and onboarding.

---

## 3. Who to sell to

Unchanged from #388, and it matches the `/for` pages.

**Segment:** US ambulatory providers with 10–150 staff, accredited or
preparing for it, no IT department, and no incumbent policy system. In priority
order:

1. **Ambulatory surgery centers.** AAAHC, Joint Commission or AAAASF. Sharpest
   survey moment, one decision maker, 100–300 policies on a shared drive.
2. **Home health and hospice.** CHAP, ACHC or Joint Commission. High turnover,
   so "who approved this?" breaks constantly.
3. **Behavioral health and SUD programs.** CARF or Joint Commission.
4. **Rural health clinics, FQHCs, urgent care.**

**Buyer:** the administrator, DON, or quality/QAPI coordinator. One person is
champion, buyer and daily user, and $39–$117 a month fits on their card without
asking anyone. That fact is the whole reason this segment is winnable.

**Disqualify fast:** hospitals and health systems; anyone who wants patient
data in it or a BAA (decided 2026-10-07: Bindersnap holds no PHI); EHR, SSO or
on-premise requirements; anyone mid-contract with PolicyStat, PolicyTech or
PowerDMS unless renewal is within 90 days and they volunteer unhappiness;
FDA-regulated manufacturers (Part 11).

**Rank prospects by trigger**, strongest first:

1. A survey in the next 3–9 months
2. A recent deficiency citation (CMS statements of deficiency are public for
   many provider types)
3. A new administrator or DON in the last six months (LinkedIn job-change
   alerts)
4. A new site opening, which is a manual built from nothing, with no migration
5. An incumbent's price increase at renewal

---

## 4. Where the conversations come from

Ranked by cost per first customer.

### Tier 0: your wife's network (customer #1)

The founding story is literally true, and her network is the ICP.

- Write down **20 named people** with her: colleagues, former colleagues, the
  compliance lead at her last workplace, the consultant who ran their last
  survey prep.
- Ask her for **five introductions**, spent on the five with the strongest
  triggers.
- Ask her to share `bindersnap.com/pricing` once, in her own words, in a peer
  group chat or association forum.

### Tier 1: accreditation consultants (customers #2–#10, and Phase 2)

Independent consultants prepare small providers for AAAHC, ACHC, CHAP and CARF
surveys. They rebuild policy manuals by hand for a living, across many clients.
They are your distribution, and they are the bridge to Phase 2.

- Find them on LinkedIn ("accreditation consultant" plus the accreditor), on
  state association conference speaker lists, and by asking every prospect "who
  helped with your last survey?"
- Offer: a free organization for their own use, and **20% of what each referred
  customer pays for 12 months**. At $78 a month that is about $190 per
  customer, which is meaningful to them and trivial to you.
- Target **five relationships**, not fifty.

### Tier 2: cold email from public lists

- CMS Provider of Services and Care Compare files on data.cms.gov, filtered to
  your state and the two next to it. Enrich by hand from the org's leadership
  page. Don't buy a list.
- One specific fact per email: the center's name, its accreditor, a new
  administrator.
- Send from a separate subdomain with SPF, DKIM and DMARC, under 30 a day.

### What the site gives you for free

The public site is now collateral, so use it in outreach instead of writing
new material:

- **`/tools/required-policies-checklist`**: the +10-day "something useful,
  no ask" email in the sequence below.
- **`/templates/*`**: Word downloads. A template the prospect actually needs
  this month is the best possible opener.
- **`/compare/policystat-alternative`** and the other compare pages: send them
  to anyone facing an incumbent renewal.
- **`/pricing`**: send it when someone asks "what does it cost?" It answers
  the next five questions too.

### Not yet

Paid ads, conference booths, webinars, LinkedIn posting for reach, Product
Hunt. Revisit after customer #5. A state association conference as an attendee
with no booth is fine after customer #1.

---

## 5. What to say

### Warm introduction request

> Subject: quick question about your policy manual
>
> Hi [Name] — [Wife] mentioned you run [role] at [Org].
>
> I'm building something for policy manuals at places like yours, and I'm
> trying to find out where I'm wrong before I go further. Not selling anything.
> I'd like 15 minutes of "here's what actually happens at survey."
>
> Would you be open to a call this week or next?
>
> David

### Cold email

> Subject: [Center]'s policy manual before the [AAAHC] survey
>
> [Name] — my wife came home frustrated with her policy system often enough
> that I built a replacement.
>
> One question, no pitch: when your last survey asked for the approved version
> of a policy, how long did it take to show who signed off, and on which draft?
>
> If the answer was "longer than it should have been," I'd like 15 minutes to
> hear how it went.
>
> David Gray, bindersnap.com

Follow up three times, then stop: **+4 days**, one line to bump it; **+10
days**, the required-policies checklist or a relevant template with no ask;
**+21 days**, the breakup ("I'll stop here — my door's open if approvals are
ever the thing keeping you up before a survey").

### Consultant email

> Subject: the policy manual cleanup you do by hand
>
> [Name] — you prep agencies for [CHAP] surveys, so you've rebuilt more policy
> manuals than anyone I could ask.
>
> I built a system where every policy carries its own approval record — who
> signed off, when, on exactly which version — so the manual doesn't drift back
> into a shared drive after you leave.
>
> I'd like to give you a free account to poke holes in it. If it ever fits a
> client, I pay 20% of what they pay for their first year. Worth 20 minutes?
>
> David

### The 30-second version

> In most clinics the policy manual lives on a shared drive, and when a
> surveyor asks who approved a policy, somebody spends a weekend rebuilding it
> from email. Bindersnap gives every policy a record of who signed off on
> exactly which version, and it can't be edited after the fact. It's $39 a
> month for each person who writes policies. Your medical director and your
> staff are free.

---

## 6. The calls: discovery first, then a demo on their own documents

**Call 1, discovery: 20 minutes, no screen.** Ask only about the past:

1. Walk me through the last policy that got approved. Who wrote it?
2. Where does it live now? What's the file called?
3. How does staff know it's the current one?
4. Who signed off, and how would you show me?
5. When was the last survey? What did they ask for on policies? Was anything
   cited?
6. How many policies, and in what format?
7. Who writes them, and who approves them? (This tells you the seat count:
   writers pay, approvers don't.)
8. What have you already paid for to fix this?
9. Who else is involved in a decision like this?

Never ask "would you use this?" or "would you pay for this?"

**Score it, one point each, and pursue at 3 or more:** survey within 9 months;
cited or nearly cited on policies; more than 50 policies; already paid for a
fix; can spend $100 a month without asking anyone.

**Close call 1 with homework:** "Send me two of your messiest real policies and
I'll show you your own manual next week." Prospects who send files convert;
prospects who don't, mostly don't.

**Call 2, demo: 30 minutes, 7 of them on screen**, loaded with their two
documents. Follow the survey, not the menu:

1. **Start at the end.** Open a document's history and download its audit
   packet. "This is what you hand a surveyor."
2. Open their policy: the current version, who approved it, and when.
3. Propose a change by uploading their revised Word file.
4. Show the comparison: changes marked inside the rendered policy.
5. Approve as a reviewer, then publish. "An approved policy can't change
   without a new version someone reviews. That's the product."
6. Back to history: the new version and its approval.
7. Open People and point at the reviewers: "Your medical director approves for
   free."

Don't show signup, billing, settings or the roadmap.

**Ask on the call, then stop talking:**

> "Here's what I'd suggest. Send me the folder and I'll load your whole manual
> this week. Once it's in and you've looked at it, it's $39 a month for each
> person who writes policies, and you can cancel any time. Should I start the
> import?"

If they hesitate, ask: "What would have to be true for this to be an easy
yes?"

---

## 7. The founding customer offer

Generous with labor, not with price:

- **$39 a writer, and that price never goes up for you** while you stay a
  customer. (Put this in writing in the welcome email. Before the first one goes
  out, decide whether it holds if list price rises.)
- **I load your existing manual myself** during the 14-day trial, before you
  pay anything.
- **You have my cell number.**
- **Your requests go to the front of the queue**, and I'll tell you honestly
  what I won't build.
- **Cancel any time.** Reading and exporting stay free, so you never lose your
  record.

**No unpaid pilot beyond the 14-day trial.** No discount, no annual plan, and
no setup fee (the pricing page promises none). If they won't pay $39 after
seeing their own manual approved, then the pain isn't real for them or you are
talking to the wrong person. Learn that in week two, not month four.

---

## 8. Honest answers to the objections you'll hear

- **"Is it HIPAA compliant? Will you sign a BAA?"** "Bindersnap holds policies
  and procedures, not patient information, and our terms say not to put PHI in
  it. We don't sign BAAs." Never say "HIPAA compliant." If they need a BAA
  anyway, disqualify politely.
- **"What if you go out of business?"** "Every version and every approval
  exports to PDF and Word, with an audit packet per document, any time,
  including after you stop paying. Our Terms give you at least 30 days to
  export if the service ever ends." This is true today.
- **"We have PolicyStat / PolicyTech."** Ask "if you were starting over, would
  you buy it again?" Respect the answer, and send the compare page only if they
  say no.
- **"Is this Part 11 e-signature?"** "No, and I won't tell you it is. It
  records who approved which version and when, in a history that can't be
  rewritten."
- **"I need to ask the owner / board."** "What would help you make that case?"
  Send a one-page summary within 24 hours.
- **"Can it do training attestation / competency tracking?"** "Not today."
  Write it down. When three prospects ask, it goes on the roadmap (#371 already
  exists).

---

## 9. What you do by hand, and when to stop

| Do by hand now                                                      | Stop when                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| Import each customer's manual; convert `.doc` to `.docx` yourself   | A customer adds 50 documents without you (about customer #3)  |
| Weekly 10-minute phone check-in for 90 days                         | You have more than 10 customers                               |
| Produce a whole-manual audit export by zipping per-document packets | Two customers ask for it before a survey: then it's a feature |
| Onboard reviewers by inviting them yourself                         | Never a blocker; invitations are built                        |

**Build nothing a prospect hasn't asked for by name on a call.** The one
exception is any bug you hit during an import or a demo.

---

## 10. The next 30 days

Week 1 starts Monday, 2026-10-19.

**Week 1 (Oct 19–25): start the clocks, fill the list.**

- Apply `infra/email` and request SES production access. Fill in the legal
  placeholders and send the documents to counsel. Request an insurance quote.
- Write the 20 warm names; ask for five introductions.
- Pull the CMS file for your state plus two neighbors, filter to ASCs, and
  enrich 50 contacts.
- Find 10 accreditation consultants.
- Send 5 warm requests, 10 consultant emails and 25 cold emails.
- **Target: 5 discovery calls booked.**

**Week 2 (Oct 26–Nov 1): discovery, and the cutover.**

- Run every call. Take notes in the prospect's own words. Ask every qualified
  prospect for two policies.
- Run Stripe, edge and Turnstile, the click-through, and the wipe. Merge #763
  once SES access and counsel's review are back.
- Send 30 more cold emails, and keep the follow-ups going.
- **Target: 5 calls done, 3 prospects scoring 3+, 2 sets of real policies.**

**Week 3 (Nov 2–8): demo on their documents, on production.**

- Create each prospect's organization on production and load their two
  policies before the call.
- Run the 7-minute demo. Ask on the call.
- **Target: 3 demos, 1 verbal yes.**

**Week 4 (Nov 9–15): close and onboard.**

- Import the first customer's full manual. Watch them approve something real.
- A verbal yes is not a customer. **The card goes in on Billing.**
- Rewrite the landing hero with the three sentences you heard most often.
- **Target: 1 paying organization, or a written account of why not.**

### The scoreboard

Update it daily in one spreadsheet, and track nothing else.

| Metric                                | 30 days | 90 days |
| ------------------------------------- | ------- | ------- |
| Discovery calls with the actual buyer | 15      | 40      |
| Prospects scoring 3+                  | 5       | 15      |
| Demos on the prospect's own documents | 5       | 12      |
| Paying organizations                  | 1       | 4–5     |
| Paid writer seats                     | 1–3     | 7+      |
| Active consultant referral partners   | 2       | 5       |
| Cold email reply rate                 | 8%+     | 8%+     |

At 90 days, 7 writer seats covers every running cost. That is the first
definition of profitable.

---

## 11. After the first five: getting to 80

Don't start any of this before customer #3. It's listed so the hand-selling
collects the right material.

1. **Consultants become the channel.** Each active partner who sends three
   clients a year is worth a pipeline of their own. Give them a referral link
   with attribution and a monthly statement. Build that only once three
   partners exist.
2. **The site sells for you.** Rewrite `/for/*` and the landing page with
   customer language and a named quote. Add a template or requirements page
   for every question prospects ask more than twice.
3. **Self-serve import.** Whatever you scripted for customers 1–3 becomes the
   onboarding path, so a stranger can load 200 documents alone.
4. **Revisit pricing once, with data.** Re-check after five customers. If the
   median is one writer and churn is low, consider an annual plan. If buyers
   keep asking for a single organization price, reconsider a base fee. Don't
   change it before then.
5. **Associations.** One state ASC or home care association conference, as a
   sponsor, once you have a reference who will talk to peers.

## 12. When to change direction

After 15 calls with the right titles:

- **Nobody has been burned by a version question:** the pain is elsewhere. The
  calls will have told you where.
- **Everyone agrees and nobody pays $39:** you're reaching the person who
  suffers, not the person who buys. Move up one title.
- **Every serious prospect needs a BAA or a security questionnaire:** the next
  work is trust (SOC 2 readiness, a security page), not features.
- **Prospects want attestation more than approval** (#371): that's a signal
  about what the product is, and it's worth a conversation before more code.

## 13. Decisions only you can make

1. **Founding price lock.** Does "your price never goes up" survive a future
   list-price change? Decide before the first welcome email.
2. **Consultant referral terms.** Is 20% of the first 12 months right, and is
   it paid monthly or as a lump sum?
3. **Counsel.** Who reviews the Terms, Privacy and DPA, and for what fixed fee?
4. **Insurance.** Whether to carry E&O and cyber before the first customer.
   Recommended: yes.
5. **Demo before cutover.** Whether to screen-share from the local stack in
   week 2, or hold every demo until production is live.
