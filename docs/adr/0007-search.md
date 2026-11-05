# ADR 0007: One Search Box, and an Index of What Is on `main`

Status: Proposed (design; nothing built yet)
Date: 2026-11-04
Amends: nothing. The document index is the second derived index under
[ADR 0004](0004-organization-workspace-folder-and-org-billing.md)'s rule, after
the activity dataset (`services/api/activity.ts`), and it follows that rule
exactly.

## Why This Exists

The nav's search (quick find, `apps/app/components/NavSearch.tsx`) is one box
that finds six kinds of thing: Bindersnap's own pages and controls, documents,
changes, binders, organizations and people. Each kind is answered differently
today, and the document answer is the weak one. A reader opens Bindersnap to
find out what the policy says, and search cannot help them with that.

- **It matches document titles only.** `readLibrary`
  (`services/api/server.ts`) filters on a document's name, its path and its
  binder's name. A policy titled "Hand Hygiene" is invisible to a search for
  "alcohol-based rub".
- **It matches one exact string.** "hand policy" does not find "Hand Hygiene
  Policy". Nothing is ranked; results are sorted by binder, then path.
- **Every keystroke reads the whole library.** Quick find lists every binder in
  every organization the person belongs to, then reads each binder's tree, open
  changes and tags. The cost grows with the number of binders, and the panel
  asks again as the person types.

This ADR decides what the box searches for each kind, and how document
contents become searchable.

## Decision

**One box, one panel, six kinds. Each kind is read from the place that already
holds it. Documents are the one kind that needs an index of our own: the text
of each document as it is on `main` today, in SQLite, derived from Gitea.**

### What the box finds

| Kind           | Matched on                            | Read from                                                                                |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Page or action | Name and the words people type for it | A fixed list in the app (`apps/app/quickFindActions.ts`), matched in the browser         |
| Document       | Title, path and **contents**          | The document index, `search.db` (§1–§6 below)                                            |
| Change         | Title and description                 | Gitea's issue indexer, `/repos/issues/search`, kept to the reader's organizations        |
| Binder         | Name and description                  | The reader's own list of binders, matched in the browser                                 |
| Organization   | Name                                  | The reader's own list of organizations, matched in the browser                           |
| Person         | Name and username, never email        | Members of the reader's organizations, matched in the browser; never Gitea's user search |

The rules that hold for every kind:

- **Nothing is copied to be searchable when its source already answers.**
  Pages and actions are the app's own list. Changes, binders, organizations and
  people are Gitea's (ADR 0004, question 1), so they are searched where they
  live. Only document contents need an index, because Gitea cannot search them
  for us (see "Not Now").
- **Every kind is scoped to the reader.** A result is only ever something the
  reader can already open. People are their colleagues, not every account.
- **One panel.** Results are grouped by kind in the order of
  `orderQuickFindResults` (`apps/app/quickFind.ts`): pages and actions first,
  because one matches only when a word of its name was typed, then documents,
  because that is what people look for most. Searching contents makes this
  order matter more: "billing" will now also match every policy that mentions
  billing, and the Billing page must still come first. Each group pages on its
  own, and one group failing never empties the others.
- **The query is read the same way for every kind**: split into words, each
  word must match, case, accents and punctuation ignored. A query that finds
  "Hand Hygiene Policy" as a document finds a change titled the same.

Changes are the one kind that is not limited to `main`: a change is by nature
in flight, and finding it is the point. Their contents (the documents they
change) are not searched; their title and description are.

The rest of this decision is about documents.

### 1. Document contents: only `main`, only the current version

- A draft or an open change is not searched. It has not been approved, and a
  reader who finds unapproved text has found the wrong answer.
- **An older version is never searched.** A reader is looking for what to do
  now. A hit in the version that `v4` replaced is a hit in a policy nobody
  should follow. History stays where it is: the document's versions, and the
  comparison.
- Archived documents are not searched, for the same reason.

This keeps the index small: one copy of each document, not one per version.

### 2. What a row is

The index holds **passages**. A passage is one block of a document, the same
`DocumentBlock` the comparison already uses (`apps/app/documentBlocks.ts`): a
heading, or a paragraph under it.

| Format         | How the text comes out                             | A passage is                        |
| -------------- | -------------------------------------------------- | ----------------------------------- |
| Editor `.json` | Walk the Tiptap tree; skip images                  | A block: paragraph, list item, cell |
| `.docx`        | mammoth to HTML, then blocks (`docxHtml.ts`)       | A paragraph or heading              |
| PDF            | pdfjs text, then blocks (`pdfText.ts`)             | A recovered block, with its page    |
| `.md`          | The Markdown blocks                                | A paragraph or heading              |
| Anything else  | Not read. The document is found by its title only. | —                                   |

Each passage row carries the binder, the document's UID (ADR 0005), the **blob
SHA** of the file it came from, its ordinal in the document, the heading it sits
under, a page number for a PDF, and the text. Picture captions and alt text are
indexed; image data never is.

A scanned PDF has no text layer and yields no passages. OCR is out of scope.

**One walker, two callers.** The code that turns a file into passages runs in
the index job and in the reader that scrolls to a passage. Both must count
blocks the same way, or passage 12 in the index is passage 13 on screen. It
lives in `packages/utils`, beside the sanitizer, so neither side can drift.

### 3. Where it lives

- **SQLite FTS5**, through Bun's own `bun:sqlite`. FTS5 gives relevance ranking
  (BM25), English stemming ("disinfecting" finds "disinfect"), prefix queries
  for typing, and highlighted snippets.
- **Its own file, `search.db`**, beside `sessions.db` and not in it. It is not
  replicated by Litestream and not backed up. Losing it loses speed, not
  evidence: the job rebuilds it from Gitea. Keeping it out of `sessions.db`
  keeps the database we _do_ back up small.
- A second table records, per binder, the `main` commit SHA the index was last
  built from.

### 4. How it stays current

A job, never a request handler, as ADR 0004 requires of a derived index.

1. For each binder, compare `main`'s commit SHA with the one last indexed. Equal
   means nothing to do.
2. If it moved, read the tree and compare blob SHAs. Extract only the files
   whose blob changed; delete the rows of files that left `main`.
3. Record the new commit SHA.

Two things start a pass: a publish (the publish job marks its binder to be
checked, `services/api/jobs/`), and a slow sweep of every binder that catches
anything a publish missed. A full rebuild is the same loop starting from an
empty file.

Every row keys on a blob SHA, so a row is either correct or visibly stale. It
is never subtly wrong.

### 5. Gitea decides who sees what

**The index decides what matches, never who may see it.** A search first asks
Gitea which binders the person can read, as `readLibrary` does today, and the
query is limited to those binders. A person removed from a binder stops seeing
its results on their next search, whatever the index holds.

**The index serves browsing; Gitea serves proving.** No publish gate, approval
check or audit export reads `search.db`.

### 6. What a result does

- **First: open the document.** Hits are grouped by document. Each shows its
  title, binder and one highlighted snippet. Picking it opens the document.
- **Then: go to the passage.** The link carries the terms, the passage ordinal
  and the blob SHA:
  `/{org}/{binder}/-/blob/main/{path}?find=<terms>&at=<passage>&blob=<sha>`.
  - An editor document or a Word file: the reader scrolls to that block and
    highlights the terms.
  - A PDF: the preview opens at that page.
  - If `blob` no longer matches the file on `main` (it was published again in
    between), the reader ignores `at` and goes to the first match of the
    terms instead.

Quick find gets faster as a side effect: titles come from the index too, so it
no longer reads every binder on every keystroke.

## How Far This Goes

### The document index

These numbers are for **the whole deployment**: one host serves every
organization, so one index holds every binder. They are estimates from typical
policy sizes. Before building, a benchmark against a scaled-up seed must confirm
them, and confirm that mammoth and pdfjs run under Bun on the server as they
do in the browser. This section is corrected with what it finds.

**The sizing assumptions.** A policy runs 2,000–4,000 words, about 15–25 KB of
text in 40–100 passages. FTS5 stores the text and its index at roughly two to
three times the text, so **about 50 KB per document**. Extraction costs about
0.1–0.5 s of CPU for an editor or Word document and 20–50 ms a page for a PDF.
Production is one t4g.medium (4 GiB, 30 GB root volume, burstable CPU; see
`infra/compute/main.tf`).

#### Green: this architecture as written

Up to **10,000 documents** on `main` across the deployment, about **1 million
passages**, an index under **1 GB**.

- A search answers in under 100 ms at p95.
- A full rebuild finishes in under an hour.
- The index uses under 5% of the root volume.

The first customers are small providers with 50–300 policies each. Green holds
for roughly 30–200 of them.

#### Amber: start planning, change nothing yet

When **any** of these is true:

- 25,000 documents, or 2.5 million passages
- `search.db` over 2 GB
- p95 search over 200 ms
- a full rebuild over 2 hours, or one that exhausts the host's CPU credits
- the API container's memory approaches its limit while a pass runs

Amber has fixes that keep the same design:

- **Partition by organization**: one FTS table, or one file, per organization.
  A query then never ranks another organization's matches before discarding
  them. This is the first fix to make, because cost today grows with
  everyone's documents, not the searcher's.
- **Cap a document's passages.** One 600-page manual should not cost what 100
  policies cost. Index its first N passages and record that it was cut short.
- **Put `search.db` on its own volume**, and move the host up one size.
- **Throttle the job**: extract a few files at a time, so a rebuild cannot
  starve the API.

#### Red: move to a dedicated search engine

When **any** of these is true, Amber's fixes in place:

- 100,000 documents, or 10 million passages
- p95 search over 500 ms
- a full rebuild no longer fits overnight
- a feature FTS5 cannot do well: typo tolerance across a large index, meaning
  rather than words at scale, or languages other than English

The move is to an engine built for it (Meilisearch, Typesense or OpenSearch),
**on its own host**. That is a second host, which ADR 0003 does not allow, so it
needs its own ADR. Because extraction, the passage model, the permission check
and the result links all stay the same, only the store changes. The index code
sits behind one module so that swapping the store does not touch its callers.

### The other kinds

Pages and actions are a short fixed list and have no limit worth stating.
Changes, binders, organizations and people are not indexed by us, so their
limits are Gitea's and the browser's:

- **Binders, organizations and people** are matched in the browser from lists
  the reader already holds. That is right, by estimate, while a reader
  belongs to fewer than about **200 binders** or **2,000 colleagues**. Past
  either, the lists are too long to fetch and match on every search: move the
  matching to the API, which asks Gitea with the query rather than for the
  whole list.
- **Changes** are searched by Gitea's issue indexer, then filtered to the
  reader's organizations. The API reads four times the rows it shows to leave
  room for that filter (`handleSearchChanges`). If the filter regularly leaves
  fewer rows than fit the panel, pass the reader's repositories to Gitea's
  search instead of filtering after it. Gitea's issue indexer is on its
  default, bleve, on disk. If change search slows past p95 300 ms, that is a
  Gitea configuration question first, not a reason to index changes ourselves.

### Knowing which zone we are in

These numbers are useless if nobody can see them. The site admin's system page
(`/-/admin/system`) shows the document count, passage count, `search.db` size,
p95 search time over the last day and the last rebuild's duration, each marked
against the thresholds above.

## Not Now: Gitea's Repository Indexer

Gitea can index repository contents (`[indexer] REPO_INDEXER_ENABLED`). If it
could answer document search, we would rather use it than keep an index of our
own: one less thing to build, run and rebuild. Today it cannot:

- **No API.** Gitea 28 exposes no code search endpoint
  (`services/api/gitea-client/spec/`), so the API would have to scrape Gitea's
  HTML pages. Gitea has work in progress to add one.
- **It indexes the wrong content.** Editor documents are Tiptap JSON, so markup
  is indexed with the words and snippets come back as JSON. Word files and
  PDFs are binary and skipped. Large files are skipped, and embedded pictures
  make documents large.
- **It is keyword search.** Its "fuzzy" mode tolerates typos. It does not
  understand meaning.

Querying its Elasticsearch index (`gitea_codes`, with
`REPO_INDEXER_TYPE = elasticsearch`) directly would get round the missing API,
and it does index only the default branch. It costs 1–2 GiB of heap on a 4 GiB
host, reads an internal format that a Gitea upgrade may change, and holds the
same JSON markup and the same gaps.

**Revisit when** Gitea ships a code search API. Even then, it is worth using
only for what it can read well: it would still see an editor document as JSON
and skip every Word file and PDF. Unless Gitea can also index text extracted
from a file rather than its raw bytes, it could at best serve Markdown, and
this index stays. Writing a plain-text copy of each document into the binder
so Gitea could index it is not an option: a binder holds evidence, and a copy
made for search is not.

The index code sits behind one module, so moving any part of document search to
Gitea later does not touch its callers.

## Rejected: Searching Every Version

Rejected for readers in §1. It would also multiply the index by the number of
versions each document has had.

## Later, Not Now

- **Synonyms for healthcare vocabulary**: hand hygiene and handwashing, C. diff
  and Clostridioides, PPE and personal protective equipment. A short list
  applied to the query, which helps more than anything else for these
  customers.
- **Search by meaning**: embeddings on the same passage rows (for example
  `sqlite-vec`). Computing embeddings sends policy text to a provider, which
  adds a subprocessor and changes the legal pages, or runs a model on the host,
  which costs memory it does not have. Its own ADR.
- **Typo tolerance**: FTS5's trigram tokenizer, at the cost of a larger index.

## Consequences

- A new store of customer document text on our own host. No new third party,
  but the security page may need a line saying search text is kept to answer
  searches and rebuilt from the binders. A `legal-reviewer` pass is part of the
  build.
- The passage walker moves to `packages/utils` and is shared by the index job
  and the reader.
- `readLibrary` keeps answering the library page. Quick find's documents move
  to the index; its other kinds keep their sources, and all of them read the
  query the same way.
- `AGENTS.md`, which names the activity dataset as the one derived index built
  so far, names this one too once it is built.
