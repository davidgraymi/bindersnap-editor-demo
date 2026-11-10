# From here to the first paying customer, and then to profit

Written 2026-10-16, updated 2026-11-10 against `main`. This replaces the
playbook in #388, which was written in August for a $100 flat price and a
product that billed each reviewer. Its sales method still holds and is
condensed here. Its price, its product gaps and its offer have all changed.

The short version:

1. **Production is live, and nobody has been asked.** The cutover merged on
   2026-10-22. Since then: five cold emails, no replies, no discovery calls.
   The product isn't the constraint any more. The number of conversations is.
2. **The warm channel is dry, so the plan is cold.** Consultants first, then
   the phone, then email to a named person. Five hours a week, by hand.
3. **The first five customers are hand-sold to learn, not for revenue.** At
   $39 a writer, a typical customer pays $40–$120 a month. The business is
   profitable only once customers arrive without you on the phone. The first
   customers buy you the words, references and referral partners that make that
   happen.

---

## 1. Where things stand

As of 2026-11-10.

### What is ready to sell

Everything a first customer needs is built and on `main`. Production has run
it since the cutover (#763) merged on 2026-10-22.

| Need                                       | State                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Billing per organization, reviewers free   | Built. The paywall judges the organization, not the person (#800).                        |
| $39/writer seat price, synced to Stripe    | Built (#729). The live price is `infra/billing`. Confirm it is applied (below).           |
| "What if you disappear?" — exports         | Built. Any version to PDF or Word, and a per-document audit packet (`exportAuditPacket`). |
| Reading and exporting free after a lapse   | Built, and on the pricing page.                                                           |
| Loading a manual                           | The add dialog takes several files and folders. You still do the first imports yourself.  |
| Invitations, password reset, notifications | Built (#706–#713). They need SES out of the sandbox to reach anyone.                      |
| Terms, Privacy, DPA, subprocessors         | Written, and the placeholders are filled. Counsel hasn't reviewed them.                   |
| Public site: pricing, `/for`, templates    | Built. It doubles as sales collateral (section 4).                                        |

### What has happened since October 16

- **The cutover is done.** Production runs the current model. Demo there, and
  sign prospects up there.
- **No discovery calls yet.**
- **The warm channel is dry.** Asked directly, she had nobody to recommend.
  Section 4 no longer depends on introductions.
- **There is a lead list.** 155 small providers in one metro area, from the
  CMS files, with chain-owned agencies dropped and the rest ranked by fit. It
  lives in a private spreadsheet with the scoreboard, the consultant list and
  the call script. Prospect names stay out of this repository.
- **Five cold emails went out on 2026-10-27.** No replies and no bounces. The
  follow-ups due on November 2 weren't sent. They were drafted on November 10.
- **Ten more first emails are written** to named administrators, with no
  address to send them to.

### What five emails with no reply tells you

Nothing about the product, and little about the message. At a 5% reply rate,
five emails produce a quarter of a reply. What it does show:

- **All five went to a shared inbox** (`info@`, `office@`). Whoever opens that
  mail is not the person who owns the policy manual, and has no reason to
  forward a stranger.
- **Nobody was followed up.** In cold outreach the second message draws about
  as many replies as the first.
- **The emails explained the product.** They carried a pitch, a link and an
  offer. The email in section 5 asks one question and stops.
- **One went from a personal address.** Send everything from the Bindersnap
  address.

The fixes are a named person, one follow-up, a shorter email and the phone.
None of them is more volume.

### Check before the first demo

None of these could be confirmed from the repository. Each takes an hour or
less to check, and each one stops a sale if it is wrong.

1. **Walk the money path on production with a real card.** Sign up with an
   outside email address → organization → binder → document → change → approve
   → publish → subscribe → cancel, then refund yourself. This checks the $39
   live price, the live Stripe keys and the receipt in one pass.
2. **SES production access.** The verification email from step 1 arrives at an
   address that isn't yours. In the sandbox it never does.
3. **Stripe account details.** The live account is Solid Gray LLC's, with the
   LLC's bank account, statement descriptor `BINDERSNAP`, and the support
   email and phone you want on receipts.
4. **Email Routing.** `privacy@`, `security@`, `team@` and `notifications@`
   forward. The legal pages promise these addresses.
5. **Counsel.** The Terms, Privacy and DPA have been sent for review. A buyer's
   compliance lead reads the DPA.
6. **Insurance.** A quote for tech E&O plus cyber liability. Small healthcare
   buyers increasingly ask for a certificate of insurance. Budget an estimated
   $1,000–2,000 a year, then replace that with a real quote.

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

Revised 2026-10-16 from #388's version, after one fact changed the plan: the
founder's warm network is inside a large national hospital system. That system
is a customer type Bindersnap disqualifies. The people one step out from it are
not, and they decide the order below.

**Segment:** independently owned US providers with 10–150 staff, accredited or
preparing for it, no IT department, and no policy management system. They may
still buy a template manual (see "The real competitor" below). In priority
order:

1. **Home health and hospice agencies.** CHAP, ACHC or Joint Commission. A
   hospital's discharge planners deal with them every day, and their community
   liaisons visit the hospital to win referrals. That makes them the shortest
   warm path from the founder's network. High turnover means "who approved
   this?" breaks constantly.
2. **Physician-owned ambulatory surgery centers.** AAAHC, Joint Commission or
   AAAASF. The surgeons who own them usually also operate at the local
   hospital. Sharpest survey moment, 100–300 policies on a shared drive.
3. **Small management companies running 3–10 independent sites** (ASC or home
   health). One buyer, many writers and one manual reused across sites: the
   best fit for per-writer pricing. Treat each as its own deal.
4. **Behavioral health and SUD programs.** CARF or Joint Commission.
5. **Rural health clinics and FQHCs.**
6. **Experiment: independent and physician-office clinical labs.** CLIA, and
   CAP if accredited, require the lab director to approve procedures and review
   them on a schedule. Check the current CAP checklist before the first email.
   Run ten conversations, and keep going only if three or more score 3+.

**Buyer:** the administrator, DON, or quality/QAPI coordinator. One person is
champion, buyer and daily user, and $39–$117 a month fits on their card without
asking anyone. That fact is the whole reason this segment is winnable.

**Disqualify fast:**

- Hospitals and health systems, including the founder's household employer
  (see "The hospital network" in section 4).
- Sites owned by a chain or a national management company. Their manual comes
  from corporate, so the local administrator can't buy.
- Unaccredited physician practices. No surveyor means no deadline and weak
  pain. Keep `/for/medical-practices` for search traffic, but spend no calls
  on them.
- Anyone who wants patient data in it or a BAA (decided 2026-10-07: Bindersnap
  holds no PHI); EHR, SSO or on-premise requirements; FDA-regulated
  manufacturers (Part 11).
- Anyone mid-contract with PolicyStat, PolicyTech or PowerDMS, unless renewal
  is within 90 days and they volunteer unhappiness.

**The best predictor is what they already do.** The strongest qualifier is that
they already keep some record of approval by hand: a signature page, an annual
review log, a sign-off sheet at the front of the binder. They value the record
and are doing Bindersnap's job on paper. Ask about it on every call (section 6).

**The real competitor is a template manual, not nothing.** Check this on the
first calls: many small agencies and surgery centers buy a ready-made policy
manual from a template vendor or consultant, then update it in Word once a
year. Bindersnap doesn't replace the template. It's where the template lives
once it has been adopted and approved. Template vendors belong in channel 1
with the consultants, unless they sell a policy system of their own.

**Rank prospects by trigger**, strongest first:

1. A survey in the next 3–9 months
2. A recent deficiency citation (CMS statements of deficiency are public for
   many provider types)
3. A new administrator or DON in the last six months, especially one who has
   just left a hospital: they're used to a policy system and now have a shared
   drive (LinkedIn job-change alerts)
4. A new site opening, which is a manual built from nothing, with no migration
5. An incumbent's price increase at renewal

---

## 4. Where the conversations come from

Reordered 2026-11-10. The October version put warm introductions first. That
channel produced no names, so the order is now consultants, the phone, and
cold email to named people.

### Her as the expert, not as a source of names

Her colleagues aren't customers. A national system has procurement, a vendor
security review and probably a policy system already. The plan was to work one
step out from the hospital: former colleagues at small providers, discharge
planners, agency liaisons, surgeons who own part of a surgery center. **Asked
directly, she had nobody to recommend.** Don't press it. A forced introduction
is worse than none.

She is still worth an hour. She is a nursing leader who manages policies for a
hospital system, which makes her the primary user of this kind of software at
the largest scale it's sold. She should see the demo before any prospect does.
Ask her:

- How does a policy get approved, reviewed and retired where she works? What
  does the system they use do well, and what does it do badly?
- What do surveyors ask her for, and what took longest to produce last time?
- Run the 7-minute demo (section 6) for her. Where did she get lost, and what
  did she expect that wasn't there?

Don't use her employer's policies as demo content or as a source for the site's
templates. Don't use anything she learned at work that isn't public (vendor
pricing, contracts, internal documents).

If a name does come up later, the rules stand:

- Her job is managing policies, and Bindersnap is policy management software,
  so a household business in her own field is the kind of interest a
  hospital's conflict-of-interest policy usually asks staff to disclose. She
  discloses it in writing, to her employer's compliance office, before the
  first introduction.
- Introductions happen on her own time and her own phone, never through work
  email, work systems or work contact lists.
- She takes no part in her employer's choice of policy software that could
  involve Bindersnap.
- Never name her employer or its policy vendor in outreach, on the site, or in
  this repository, which is public.

### Channel 1: accreditation and survey consultants

Independent consultants prepare small providers for AAAHC, ACHC, CHAP and CARF
surveys and for state licensure. They rebuild policy manuals by hand for a
living, across many clients. One consultant who likes the product knows more
buyers than a year of cold email reaches. With no warm network, **they are the
warm network**.

- The list is the Consultants tab of the lead spreadsheet: a dozen firms, the
  local ones first.
- Find more by asking every prospect "who helped with your last survey?", and
  from state association conference speaker lists.
- Skip any firm that sells its own policy subscription. It is a competitor.
- Ask for their view, not their clients (section 5). Offer a free organization
  of their own.
- The state home care and hospice association takes vendors as associate
  members. Price it, and join only after the first customer.
- Target **five conversations**, not fifty emails.

### Channel 2: the phone

Small agencies rarely publish a named email address. The administrator's name
is often public and the address is not, and a message to `info@` is read by
whoever opens the mail. A two-minute call fixes both.

- Call the main number between 10 and 11:30 or between 2 and 4, Tuesday to
  Thursday.
- Ask for the administrator or the director of nursing by name. If they pick
  up, ask the one discovery question (section 6) and listen. Don't pitch.
- If they don't, ask the front desk for the best email address for them. That
  is a good outcome: the first email now goes to a person.
- The script is the Call script tab of the lead spreadsheet.

### Channel 3: cold email to a named person

- The list comes from the CMS Provider of Services and Care Compare files on
  data.cms.gov, for one metro area first. Chain-owned providers are dropped.
  Don't buy a list.
- **15 first emails a week, written and sent by hand, each to a named
  person.** No sending tool and no sequence software. At this volume the
  Bindersnap address is fine and a separate sending domain isn't needed.
- One specific fact per email: the provider's name, its accreditor, a new
  administrator. Never its survey results.
- No name, no email. Put the lead on the phone list instead.

### What the site gives you for free

The public site is now collateral, so use it in outreach instead of writing
new material:

- **`/tools/required-policies-checklist`**: something useful to send, with no
  ask, to a prospect who replied once and went quiet.
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

Kept for the day a name turns up. Nothing in section 10 depends on it.

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

Send it to a named person, by hand, from the Bindersnap address. **Follow up
once, a week later, in the same thread, and then stop.** The follow-up is three
sentences: the price, the trial with no card, and "if someone else looks after
the policy manual, I'd be glad to be pointed to them." No third email. An
unanswered follow-up moves the lead to the phone list.

Never mention a provider's survey results, citations or star ratings, however
public they are. It reads as a threat.

### Consultant email

> Subject: What happens to a policy manual after you hand it over?
>
> [Name] — you prepare agencies for [CHAP] surveys, so you've rebuilt more
> policy manuals than anyone I could ask.
>
> I built a system where every policy carries its own approval record: who
> signed off, when, on exactly which version. I'm trying to find out whether
> it solves a problem your clients actually have, or one I imagined.
>
> I'm not asking you to sell anything. I'd like 20 minutes of your view, and
> I'll set up a free organization of your own so you can poke holes in it.
>
> David

Lead with the question, not the commission. A referral fee in a first email
from a stranger reads as a scheme. Raise it only once a consultant has seen
the product and says a client could use it (section 13).

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
4. Who signed off, and how would you show me? Is there a signature page or a
   review log?
5. When was the last survey? What did they ask for on policies? Was anything
   cited?
6. How many policies, and in what format?
7. Who writes them, and who approves them? (This tells you the seat count:
   writers pay, approvers don't.)
8. Where did the manual come from: written in-house, a template you bought,
   or a consultant? What have you paid to keep it current?
9. Who else is involved in a decision like this?

Never ask "would you use this?" or "would you pay for this?"

**Score it, one point each, and pursue at 3 or more:** already keeps a
signature page or review log by hand; survey within 9 months;
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

One thing to settle: your own draft of this offer gives the first 10 customers
50% off for 12 months, which contradicts the paragraph above. Until you decide
(section 13), quote $39 and offer no discount. A discount is easy to add later
and impossible to take back.

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

Rewritten 2026-11-10. The October version assumed 60 emails a week and five
warm introductions. This one assumes **five hours a week, under $200 a month,
and no warm introductions**.

### The weekly rhythm

| Day       | Time   | Work                                                                                                         |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Monday    | 1 hour | Find a named person and an address for 15 leads. Send 15 first emails, by hand.                              |
| Tuesday   | 1 hour | Call 7 offices between 10 and 11:30 or 2 and 4. Ask one question, or leave with a name and an address.       |
| Wednesday | 30 min | Send 3 emails to consultants.                                                                                |
| Thursday  | 1 hour | Send last week's follow-ups. Answer every reply the same day it arrives.                                     |
| Friday    | 15 min | Fill in one column of the scoreboard.                                                                        |
| Any       | 1 hour | Held for calls. A discovery call beats everything else on this list. When one is booked, drop a block above. |

**Week 1 (Nov 10–16): finish what October started.**

- Send the five follow-ups to the October 27 emails. Check the From line on
  each one first.
- Call the offices of the named administrators whose first email is written
  and has no address. Ask for the best address, then send.
- Send the first four consultant emails.
- Walk the money path on production with a real card (section 1).
- **Target: 15 first emails, 5 follow-ups, 7 calls, 4 consultant emails.**

**Week 2 (Nov 17–23): the rhythm, in full.**

- 15 first emails to named people, 7 calls, 3 consultant emails.
- Any reply gets a call offered within the day.
- **Target: the first conversation with someone who owns a policy manual.**

**Week 3 (Nov 24–30): a short week.**

- Thanksgiving is the 26th. Send on Monday and Tuesday only, and don't call
  after Tuesday.
- Use the quiet days to write up what the calls and replies have said so far,
  in their words.
- **Target: 15 first emails, and the follow-ups from week 2.**

**Week 4 (Dec 1–7): ask for documents.**

- The rhythm again. Ask every qualified prospect for two policies and load
  them into an organization on production before the demo.
- Run the 7-minute demo (section 6) for whoever sent documents.
- **Target: 1 demo on the prospect's own documents, 1 trial started.**

On December 11, read the scoreboard against the targets below and apply the
stop rule.

### The scoreboard

It is the first tab of the lead spreadsheet. Fill in one column each Friday,
and track nothing else.

| Measure                                             | By Dec 11 | By Feb 8 |
| --------------------------------------------------- | --------- | -------- |
| First emails sent to providers                      | 45        | 150      |
| Follow-ups sent                                     | 45        | 150      |
| Phone calls made                                    | 20        | 80       |
| Replies and conversations                           | 4         | 15       |
| Emails to consultants                               | 8         | 25       |
| Consultant conversations                            | 2         | 5        |
| Discovery calls with the person who owns the manual | 3         | 12       |
| Prospects scoring 3 or more                         | 2         | 5        |
| Demos on the prospect's own documents               | 1         | 4        |
| Trials started                                      | 1         | 3        |
| Paying organizations                                | 0         | 1–2      |
| Paid writer seats                                   | 0         | 2+       |

The October targets (15 calls and a paying customer in 30 days) needed warm
introductions and three times the hours. These are what five hours a week of
cold work can honestly produce. A trial that starts in week 4 pays in week 6.

**The stop rule.** If fewer than 2% of first emails have had a reply after 60
of them, cut cold email to 10 a week and move the time to phone calls and
consultants. Do not answer a low reply rate with more volume.

Seven writer seats still covers every running cost. That is the first
definition of profitable, and on these numbers it is a spring target, not a
winter one.

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

1. **A founding discount, or none.** Section 7 says no discount. Your own
   draft offer is 50% off for 12 months for the first 10 customers. Pick one
   before the first prospect asks what it costs. Recommended: no discount. At
   $39 a writer the price isn't what stops anyone, and half of $39 buys you
   nothing but a harder second year.
2. **Founding price lock.** Does "your price never goes up" survive a future
   list-price change? Decide before the first welcome email.
3. **Consultant referral terms.** Is 20% of the first 12 months right, is it
   paid monthly or as a lump sum, and do you offer it at all? The first email
   to a consultant doesn't mention it, so this can wait for the first
   consultant who asks.
4. **Counsel.** Who reviews the Terms, Privacy and DPA, and for what fixed fee?
5. **Insurance.** Whether to carry E&O and cyber before the first customer.
   Recommended: yes.
6. **Her disclosure.** If she ever makes an introduction, she discloses the
   household business to her employer's compliance office first, and you
   decide together whether she takes any formal role (advisor, equity, pay),
   since a formal role may need her employer's approval.
7. **Hours.** This plan fits in five hours a week. If you can give it ten, the
   extra five go to phone calls, not to more email.
