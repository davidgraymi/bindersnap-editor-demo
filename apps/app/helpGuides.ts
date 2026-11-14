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
          "Decide who approves. A new binder needs no approvals, so you can publish on your own while you move in. When colleagues should sign things off, choose them as the binder's approvers and set how many approvals it needs, in its settings.",
          "Publish. Open the change request and publish it. That version is now the record.",
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
          "Open the binder and choose Edit. In the editor's file panel, choose Upload (or Upload files here on a folder).",
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
          "A binder only ever shows what has been published. Until then, your document is in a change request, where the people who sign it off can read it first. That is the point: nothing reaches the record without somebody deciding it should.",
        ],
      },
    ],
  },
  {
    slug: "writing",
    title: "Writing and editing a document",
    summary:
      "Edit opens your draft. Nothing reaches the record until you propose it and it is approved.",
    sections: [
      {
        heading: "Edit works in a draft",
        paragraphs: [
          "Choose Edit on a binder, a folder or a document. Bindersnap opens the editor in a draft that is yours alone. The version on record does not move, and nobody is asked to look at anything, however long you take.",
          "The draft's name is at the top of the editor. Choose it to switch to another of your drafts or to start a new one. You can change as many documents as you like in one draft: they are proposed, reviewed and published together.",
        ],
      },
      {
        heading: "Saving",
        paragraphs: [
          "While a draft has not been proposed, it saves on its own as you type. The editor says Saving… while it does, and then when it last saved.",
          "Once a draft has been proposed, reviewers are reading it, and a new version can clear approvals already given. So from then on you choose Save yourself, and the editor asks first.",
          "If your browser closes before a save, the editor offers the unsaved words back the next time you open that document on the same computer.",
        ],
      },
      {
        heading: "Renaming, moving and archiving",
        paragraphs: [
          "The Files panel on the left of the editor lists everything in the binder as your draft has it. Rename a document or a folder, drag a document into another folder, make a new folder, or archive a document that is no longer in force. Each of these goes into your draft, like your words, and is reviewed with them.",
          "Archiving takes a document off the binder once the change is published. Its history stays, and it can be restored from the archive at the foot of the binder.",
        ],
      },
      {
        heading: "Word documents and PDFs",
        paragraphs: [
          "A Word file or a PDF opens in the editor to read, not to change. To change it, edit it in the program that made it and choose Upload new version.",
          "Or choose Edit in Bindersnap to turn it into a document you write here. Bindersnap tells you what the conversion will lose before anything is saved, and the original stays in the document's history. This only happens when you ask for it.",
        ],
      },
      {
        heading: "Proposing your changes",
        steps: [
          "Choose Propose at the top of the editor.",
          "Say what the change is and why, in a line or two. This is what reviewers and, later, a surveyor will read.",
          "Choose who should review it, then propose.",
        ],
        paragraphs: [
          "That opens a change request. You can keep editing: every save after this adds to the same change request.",
        ],
      },
      {
        heading: "Picking a draft up later, or throwing it away",
        paragraphs: [
          "Drafts in the sidebar lists every draft you have, in every binder, with the ones you have not proposed yet first. Open one to carry on. To throw away a draft that has not been proposed, open it and choose Discard in the bar at the foot of the page. A proposed draft is closed from its change request instead.",
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
          "A new binder needs no approvals, so you can publish your own changes straight away while you move in.",
          "When colleagues should sign off first, set how many approvals a change needs, and who can give them, in the binder's Settings, under Change requests. The binder's admin can change both at any time, and every change is recorded. Nobody can approve their own change, so a binder needing one approval needs one other approver.",
          "Whatever the number, a reviewer you ask holds the change until they answer, and one who asks for changes holds it until they are happy.",
        ],
      },
      {
        heading: "Who approves changes",
        paragraphs: [
          "Only a binder's approvers can approve its changes. Choose them in the binder's Settings, under Change requests, in the Every change row beside the number, or when you create the binder: groups, people, or both. The list shows everyone in your organization; only people and groups with access to the binder can be chosen. To choose someone else, give them access on the People & access tab first. Ask for 3 approvals from your Board, and nothing is published until three board members approve. Everyone else with access can still review and comment.",
          "A new binder has no approvers and needs no approvals, so you can publish while you move in. Choose approvers before you raise the number, or nothing can be published.",
          "The number is shared across everyone you choose. 3 from the Board and the medical staff means any 3 of them together, not 3 from each. To make sure one group always signs off, add a sign-off rule for it as well.",
        ],
      },
      {
        heading: "Who signs off on a folder or a document",
        paragraphs: [
          "Every binder, folder and document page shows Who signs off here: the rules set on that place, and the ones it inherits from the folders above it and the binder.",
          "To change them, choose Edit. With a folder or document open in the editor, the panel on the right lists who signs off there; add a group or a person, or take one off. Each change goes into your draft, like a rename, and is reviewed like any change: whoever signs off on changes to who signs off has to approve it.",
          "A new rule starts with the next change after it is published. The change that adds it is approved under the rules already in force.",
          "Every published version records the rule it met: how many approvals it needed, whose counted, and who gave them.",
        ],
      },
      {
        heading: "If the document changes after it was approved",
        paragraphs: [
          "By default, a new version clears the approvals already given — people approved what they read, not what came after. You can turn that off in the binder's Settings: under Change requests, it is in Before publishing. The change is recorded.",
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
          "Home lists what is waiting on you under Your turn: the changes you were asked to review, your own changes that were sent back or approved, and drafts you have not proposed. Each says the one thing to do. The bell in the top bar tells you when something new arrives.",
          "Change requests in the sidebar is the whole picture: every change in flight, yours or not, by where it stands.",
          "Open a change and read the Changes tab. Additions are marked in green and deletions are struck through, inside the document as it will read, so you never have to compare two files by eye.",
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
      {
        heading: "If you cannot approve",
        paragraphs: [
          "Only a binder's approvers see Approve and Ask for changes. If you see neither, you can still comment, and your comment is part of the record. The author of a change can never approve it. To become an approver, ask one of the binder's admins.",
        ],
      },
      {
        heading: "Discussions",
        paragraphs: [
          "A comment starts a discussion that others can reply to. When the question is settled, resolve it. Resolving never deletes anything: who raised a concern, who answered and who closed it all stay on the change. A binder can be set so that nothing is published while a discussion is still open.",
        ],
      },
      {
        heading: "What the panel at the top means",
        paragraphs: [
          "Needs sign-off lists each rule the change has to meet: the binder's own approvals, and any rule set on a folder or a document it touches. Open it to see who can sign off under each rule and who already has. Publishing opens when every rule is met.",
        ],
      },
    ],
  },
  {
    slug: "out-of-date",
    title: "When a change is out of date",
    summary:
      "Something else was published while your change waited. Bring it up to date, and settle anything both changed.",
    sections: [
      {
        heading: "What out of date means",
        paragraphs: [
          "A change request starts from the binder as it was that day. If another change is published before yours, the binder has moved on and yours is out of date. Nothing is lost. The change request says so in a notice at the top.",
        ],
      },
      {
        heading: "Bring up to date",
        paragraphs: [
          "Choose Bring up to date. Bindersnap adds everything published since to your change. What your change proposes stays the same, so the approvals it already has stay too.",
          "If your change and a published change both altered the same part of the same document, Bindersnap cannot choose for you. The notice offers Resolve conflicts instead.",
        ],
      },
      {
        heading: "Resolve conflicts",
        steps: [
          "Open Resolve conflicts. It lists only the places both sides changed. Everything else is already settled.",
          "For each place, choose this change's wording, the published wording, both, or neither.",
          "A Word file or a PDF cannot be merged a paragraph at a time, so you choose one whole file or the other.",
          "Finish, and the change is up to date with your choices in it. Reviewers see them like any other edit.",
        ],
        paragraphs: [
          "Choosing changes what the change proposes. If the binder asks approvers again after an edit, approvals already given are cleared and asked for again. The notice tells you which before you start.",
        ],
      },
      {
        heading: "Who can do it",
        paragraphs: [
          "Anyone who can edit in the binder can bring a change up to date or resolve its conflicts. It is usually the author, because they know what the change meant to say.",
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
        heading: "A document as PDF or Word",
        paragraphs: [
          "A document written in Bindersnap downloads as a PDF or a Word document from its page, exactly as it was written: the same words, fonts and spacing, and nothing added. If you want a header or a version number on the page, put it in the document. A file you uploaded downloads exactly as you uploaded it.",
          "To download an older version, open it from Versions on the document's page first.",
        ],
      },
      {
        heading: "The audit packet",
        paragraphs: [
          "When a surveyor asks “show me the approved version, who approved it, and when,” open the document and choose Audit packet, under Versions. You get one file with every version, every approval, every discussion, and the fingerprints that let anybody check nothing was changed afterwards. They never need to log in.",
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
    slug: "finding",
    title: "Finding a document, a version or a change",
    summary:
      "Search every binder you can open, and get back to any version that was ever approved.",
    sections: [
      {
        heading: "Search everything",
        paragraphs: [
          "Choose Search at the top of any page, or press Ctrl+K (⌘K on a Mac). Type a few letters of a name, or a phrase you remember from inside a document. Search reads the words of the current version of every document in the binders you can open, and finds binders, pages and these guides too.",
          "Search looks at what is on the record. A draft or a change request that has not been published is not in it yet.",
        ],
      },
      {
        heading: "Inside a binder",
        paragraphs: [
          "A binder lists its folders and documents. Filter this binder narrows the list as you type. On a document's page, the Files panel on the left has Go to file, which jumps to any document in the binder by name.",
        ],
      },
      {
        heading: "An older version",
        paragraphs: [
          "Open the document. Versions, on the right, lists every version that was approved, newest first. Choose one to read exactly what was in force then, and download it as it was.",
        ],
      },
      {
        heading: "What changed, and when",
        paragraphs: [
          "History, in the binder's sidebar, lists every change the binder has published: what it did to which documents, who published it and who approved it. Narrow it to one folder or a span of dates, and download the list.",
        ],
      },
      {
        heading: "A document that was archived",
        paragraphs: [
          "An archived document is off the binder but not gone. The archive is at the foot of the binder's list of documents. Open it to read any version, or restore the document, which goes through a change request like anything else.",
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
        heading: "The roles",
        steps: [
          "Owners run the organization: its people, its binders and its billing.",
          "Admins run a binder: its rules, its people and its settings.",
          "Editors write documents, propose changes and publish approved versions.",
          "Reviewers read and comment, and approve if they are among the binder's approvers.",
        ],
        paragraphs: [
          "Owner is a role in the organization. Admin, editor and reviewer are set binder by binder, so the same person can be an editor in one binder and a reviewer in another.",
        ],
      },
      {
        heading: "Who costs a seat",
        paragraphs: [
          "Owners, and anyone who is an admin or an editor in at least one binder, are paid seats. Each person is counted once, however many binders they write in. Reviewers and readers are free, and there is no limit on them.",
        ],
      },
      {
        heading: "Adding a colleague",
        steps: [
          "Open your organization and choose People & access.",
          "If they have never used Bindersnap, choose Invite by email. They get a link, make their account, and join.",
          "If they already have an account, add them by their username under Add someone.",
          "Then open the binder they should work in, go to Settings, People & access, and add them as an admin, an editor or a reviewer.",
        ],
        paragraphs: [
          "Joining the organization costs nothing on its own. A person takes a seat only once they are made an owner, or an admin or editor of a binder.",
        ],
      },
      {
        heading: "Groups",
        paragraphs: [
          "A group is a set of people you name once and use everywhere: your Quality Committee, your Board, your nursing leads. Add a group to a binder and everyone in it gets that access. Choose a group as an approver and any of its members can sign off. When somebody joins or leaves, change the group and every binder follows.",
        ],
      },
      {
        heading: "Open to everyone, or only some people",
        paragraphs: [
          "A binder can be open to everyone in your organization, so all of them can read it, or closed to everybody but the people and groups you add. Set this at the top of the binder's People & access settings. An HR investigations binder is usually closed. A safety manual is usually open.",
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

/**
 * A section's anchor on its guide's page: "Who signs off on a folder or a
 * document" is `#who-signs-off-on-a-folder-or-a-document`.
 *
 * Derived from the heading so the app can link to one section
 * (`helpLinks.ts`) and the page renders the same id (`renderHelp.ts`).
 * Rewording a heading moves its anchor: `helpGuides.test.ts` fails when a
 * link in the app points at a section that is no longer there.
 */
export function helpSectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findGuide(slug: string | undefined): HelpGuide | null {
  return HELP_GUIDES.find((guide) => guide.slug === slug) ?? null;
}
