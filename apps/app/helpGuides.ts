/**
 * The help guides: short, plain, and about the job rather than the buttons.
 *
 * Each one answers a question somebody actually asks in their first week —
 * "how do I get our manual in here?", "who has to approve this?", "what do I
 * hand the surveyor?". Kept as data so the page is one component and the
 * words can be reviewed in one place.
 */

export interface HelpSection {
  heading: string;
  paragraphs?: string[];
  steps?: string[];
}

export interface HelpGuide {
  slug: string;
  title: string;
  summary: string;
  sections: HelpSection[];
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    slug: "getting-started",
    title: "Moving your policy manual in",
    summary:
      "From a shared drive of FINAL_v3 files to one record everyone trusts, in five steps.",
    sections: [
      {
        heading: "What you are setting up",
        paragraphs: [
          "Your organization holds your binders. A binder holds documents that are run the same way: the same people read them, and the same people approve changes to them. Most teams start with one binder for the policy manual and add more later — a clinical binder and an HR binder, say, when different people sign them off.",
        ],
      },
      {
        heading: "The five steps",
        steps: [
          "Name your organization. You did this when you signed up, or you can do it from the + menu.",
          "Make a binder. Call it what your team already calls it — “Policy manual” works.",
          "Bring in your documents. Drop a whole folder on the binder: its subfolders become the binder's folders.",
          "Decide who approves. Add the colleague who signs things off. Running it alone? Set the approvals a binder needs to none in its settings.",
          "Publish. Once a change is approved, publish it. That version is now the record.",
        ],
      },
      {
        heading: "You can stop at any point",
        paragraphs: [
          "The getting-started guide on your Home page reads where you actually are, so it picks up where you left off — on any computer, even if a colleague did a step for you.",
        ],
      },
    ],
  },
  {
    slug: "adding-documents",
    title: "Adding documents: one, many, or a whole folder",
    summary:
      "Bring in what you already have. Nothing is published until someone approves it.",
    sections: [
      {
        heading: "A whole folder at once",
        steps: [
          "Open the binder and choose Add a document.",
          "Drop the folder onto the box, or choose Add a whole folder.",
          "Check the list. Take out anything you did not mean to send. Word documents and PDFs go in; system files and anything else are left out, and the list says so.",
          "Choose who should review it, then Add documents.",
        ],
        paragraphs: [
          "Everything goes in as one change request, so your existing manual is approved once — not a hundred times.",
        ],
      },
      {
        heading: "Writing a new policy here",
        paragraphs: [
          "Choose Write it here instead of Upload a file. You get a word processor that works like Word, and every save goes into your draft. Nobody sees the draft until you propose it.",
        ],
      },
      {
        heading: "Why it does not appear in the binder straight away",
        paragraphs: [
          "A binder only ever shows what has been approved and published. Until then, your document is in a change request, waiting on its reviewers. That is the point: nothing reaches the record without a decision.",
        ],
      },
    ],
  },
  {
    slug: "approvals",
    title: "How a change becomes the record",
    summary:
      "Propose, review, approve, publish — and why nobody can skip a step.",
    sections: [
      {
        heading: "The path every change takes",
        steps: [
          "Someone proposes a change: a new document, a new version, a rename.",
          "The reviewers read exactly what changed, comment, and approve or ask for changes.",
          "Once it has the approvals the binder needs, anyone who can publish publishes it.",
          "The new version is on the record, with who approved it and when, for good.",
        ],
      },
      {
        heading: "How many approvals",
        paragraphs: [
          "Each binder says how many approvals a change needs, in Settings → How changes are approved. The binder's admin can change it. Nobody can approve their own change, so a binder needing one approval needs one other person.",
          "Running a binder on your own? Set the approvals needed to none. You can raise it the day a colleague joins.",
        ],
      },
      {
        heading: "If the document changes after it was approved",
        paragraphs: [
          "By default, a new version clears the approvals already given — people approved what they read, not what came after. You can turn that off in the binder's settings, and the change is recorded.",
        ],
      },
    ],
  },
  {
    slug: "reviewing",
    title: "Reviewing a change",
    summary: "What you are being asked, and how to answer it.",
    sections: [
      {
        heading: "Where to start",
        paragraphs: [
          "Your Home page lists everything waiting on you, and the bell in the top bar tells you when something new arrives. Open a change and read the Changes tab: additions and deletions are marked, so you never have to compare two files by eye.",
        ],
      },
      {
        heading: "Your three answers",
        steps: [
          "Approve — you agree this should become the record.",
          "Ask for changes — say what needs to change. The change cannot be published while you are waiting.",
          "Comment — ask a question without deciding yet.",
        ],
      },
    ],
  },
  {
    slug: "exporting",
    title: "PDF, Word and the audit packet",
    summary: "Everything you put in, you can take out — and hand to anyone.",
    sections: [
      {
        heading: "A policy as PDF or Word",
        paragraphs: [
          "A policy written in Bindersnap downloads as a PDF or a Word document from its page, with its name and version on every page. A file you uploaded downloads exactly as you uploaded it.",
        ],
      },
      {
        heading: "The audit packet",
        paragraphs: [
          "When a surveyor asks “show me the approved version, who approved it, and when,” open the policy and choose Audit packet. You get one file with every version, every approval, every discussion, and the fingerprints that let anybody check nothing was changed afterwards. They never need to log in.",
        ],
      },
      {
        heading: "Always free",
        paragraphs: [
          "Reading and exporting your record never stops working, whatever happens with your subscription. It is your record.",
        ],
      },
    ],
  },
  {
    slug: "people",
    title: "People and who can do what",
    summary:
      "Owners, admins, editors and reviewers — and which of them cost a seat.",
    sections: [
      {
        heading: "The four roles",
        steps: [
          "Owners run the organization: its people, its binders and its billing.",
          "Admins run a binder: its rules, its people and its folders.",
          "Editors write documents and publish approved versions.",
          "Reviewers read, comment and approve. Reviewers are free.",
        ],
      },
      {
        heading: "Adding a colleague",
        paragraphs: [
          "Open People & access and add them by their Bindersnap username. They need an account first — send them to the sign-up page, then add them.",
        ],
      },
    ],
  },
  {
    slug: "notifications",
    title: "Knowing when it is your turn",
    summary:
      "The bell tells you when a change needs you, or when one you are part of moves.",
    sections: [
      {
        heading: "What the bell shows",
        paragraphs: [
          "When somebody asks for your review, comments on a change you are part of, or publishes one, the bell in the top bar gets a number. Open it to see what happened, and open a change to mark it read.",
        ],
      },
    ],
  },
];

export function findGuide(slug: string | undefined): HelpGuide | null {
  return HELP_GUIDES.find((guide) => guide.slug === slug) ?? null;
}
