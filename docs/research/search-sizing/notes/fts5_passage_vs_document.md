# SQLite FTS5: a row per passage versus a row per document — storage and CPU cost

Method note, read first. Published FTS5 sizing data is thin (one SQLite-doc email test, a few blog anecdotes), so most numbers below come from a benchmark run for this note on 2026-11-04:

- **Engine:** Bun 1.4.4 `bun:sqlite`, SQLite 3.51.0 (on macOS Bun links the system SQLite; on Linux Bun bundles its own build, so check `select sqlite_version()` on the host). Apple M1, warm cache, `journal_mode=WAL`, `synchronous=NORMAL`, 100 documents per transaction, then `optimize` + `VACUUM`. Sizes come from `dbstat`, in MiB.
- **Corpus:** synthetic, built from ~6,000 real English sentences taken from this repo's Markdown, plus 3% of words swapped for document-local rare words from `/usr/share/dict/words`.
  - Average document: 3,027 words, 17.8 KB of text, 70.3 passages. One passage in six is a 3–6-word heading; the rest are 2–4-sentence paragraphs.
  - About 1,093 unique tokens per document, and ~0.99 indexed tokens per word (29.9 M tokens across 10k documents).
- **Designs:**
  - Document design (`doc1`): `fts5(body)`, one row per document, rowid = document id.
  - Passage design (`pass`): `fts5(body)`, one row per passage, rowid = `doc_id*1024 + passage_no`, so a rowid range selects one document's passages.
- **Script and data:** `docs/research/search-sizing/bench/{bench,query,scope,vocab}.ts`.
- **Caveats:**
  - The corpus is synthetic. Term co-occurrence is less realistic than the length and vocabulary figures, because sentences are drawn independently. Multi-term AND queries therefore co-occur within a passage less often than real policy text would.
  - Timings are from an M1, not a t4g.medium. Per-core speed differences are noted as an inference, not measured.

## 1. How FTS5 stores its index, and what makes size grow (rows vs tokens)

### Takeaway

FTS5 stores a doclist per term: for each row containing the term, a rowid delta and a position list. So size ≈ (bytes per token occurrence) × tokens + (bytes per term-row pair) × pairs, plus small per-row tables. Measured: about **1.87 B per token occurrence + 1.51 B per (term, row) pair**. Splitting a document into ~70 passages leaves the token count unchanged and raises the pair count 2.3×. That is why the passage index's `%_data` is ~30% larger, not ~70× larger.

### Cited Findings

- **Shadow tables.** FTS5 keeps its index in `%_data(id, block)`, which "contains most of the full-text index data", and `%_idx(segid, term, pgno)`, "almost always much smaller".
  - `%_docsize(id, sz)` holds each row's per-column token counts and is absent with `columnsize=0`.
  - `%_content` holds the row's text and is absent for contentless or external-content tables.
  - `%_config` holds settings.
  - — [SQLite FTS5 docs §9](https://www.sqlite.org/fts5.html)
- **Segments and merging.** Entries live in immutable segment b-trees. Each commit adds usually one level-0 segment, and segments on one level are merged into the next. — [SQLite FTS5 docs §9.2](https://www.sqlite.org/fts5.html)
- **Doclist format.** "The first rowid in a doclist is stored as is, as a varint", followed by its position list, then each next rowid as a delta varint.
- **Position list format.**
  - It begins with a varint of "twice the size of the poslist ... plus one if the 'delete' flag is set".
  - Offsets are delta-encoded with +2: offsets 0, 10, 15, 16 encode as `2, 12, 7, 3`.
  - Each column other than column 0 adds byte `0x01` plus the column number before its offsets.
  - — [SQLite FTS5 docs §9.2.4](https://www.sqlite.org/fts5.html)
- **Terms and pages.**
  - Terms are prefix-compressed within a leaf page.
  - Leaf pages are ~4,000 bytes (`pgsz` default 4050).
  - A doclist index is added only when a term's doclist spans more than 4 leaf pages.
  - — [SQLite FTS5 docs §9.2.4.2–9.2.4.4, §6 pgsz](https://www.sqlite.org/fts5.html)
- **Deletes** are recorded as delete markers ("an entry with a 0 byte position-list"). Contentless-delete tables use tombstone hash pages. — [fts5_index.c](https://raw.githubusercontent.com/sqlite/sqlite/master/ext/fts5/fts5_index.c)
- **Measured, 10k documents, contentless, detail=full** (`fts5vocab` counts and `sum(length(block))` on `%_data`):

  | Design   | Rows    | Terms   | (term,row) pairs | Token occurrences | `%_data` blob bytes | B/token | B/pair |
  | -------- | ------- | ------- | ---------------- | ----------------- | ------------------- | ------- | ------ |
  | Document | 10,000  | 185,357 | 10,873,056       | 29,910,359        | 72,271,278          | 2.42    | 6.65   |
  | Passage  | 703,418 | 185,357 | 25,021,864       | 29,910,359        | 93,631,147          | 3.13    | 3.74   |
  - Source: this benchmark.
  - Solving the two rows gives ≈ **1.51 B per extra pair** (rowid delta + poslist-size varint) and ≈ **1.87 B per token occurrence** (offset varint, plus term-dictionary share).

- **Per-row overhead outside `%_data`.**
  - `%_docsize`: 7.3 MiB for 703k passage rows, about 11 B/row with B-tree overhead. With `contentless_delete=1` it is 8.9 MiB, because of the extra `origin` column.
  - `%_content`: +8.1 MiB (185.6 vs 177.5 MiB), about 12 B/row of rowid and cell overhead.
  - `%_idx`: ≤0.3 MiB in every configuration.
  - Source: this benchmark.

### Inferences

- **What drives size is the number of (term, row) pairs, not the number of rows.** A term that appears 3 times in a document costs one pair at document grain. At passage grain it costs up to 3 pairs, if the occurrences fall in different passages.
- **The pair multiplier is bounded:**
  - Policy text: ~1,093 unique terms per document versus ~2,500 summed per-passage unique terms (25.0M/10k).
  - A passage of ~43 tokens has ~36 unique terms, so pairs rise ~2.3×, not 70×.
- **Per-row bookkeeping is modest:**
  - ~11 B in `%_docsize` and ~12 B in `%_content` per row.
  - 70 rows per document ≈ 1.6 KB per document, against ~7 KB of index data per document.
- **Keep the indexed text in column 0 and add no second indexed column.**
  - A two-column document table (title + body) cost 91.2 MiB versus 70.0 MiB for body only.
  - That is +30%: every body entry pays the `0x01`+column marker.
  - The same column cost would hit a passage table too.

### Gaps

- No primary-source measurement of bytes-per-posting for FTS5 on real policy corpora. The 1.87 B/token and 1.51 B/pair coefficients are from this synthetic corpus only.

## 2. Size: computed and measured for 10k / 25k / 100k documents

### Takeaway

At every scale, the passage design's **index** (`%_data` + `%_idx` + `%_docsize`) is **1.40× the document design's**. The **whole database, with text stored**, is **1.15×**. At 100k documents that is 971 MiB versus 691 MiB of index, or 2.83 GiB versus 2.47 GiB total — both well within a 30 GB gp3 volume.

### Cited Findings

- **Measured sizes, detail=full, unicode61 tokenizer, content stored in FTS5, after optimize + VACUUM** (this benchmark):

  | Docs    | Plain text | Doc: index | Doc: content | Doc: file   | Passage: index | Passage: content | Passage: file | Index ratio | File ratio |
  | ------- | ---------- | ---------- | ------------ | ----------- | -------------- | ---------------- | ------------- | ----------- | ---------- |
  | 10,000  | 169 MiB    | 70.2 MiB   | 177.5 MiB    | 247.7 MiB   | 98.1 MiB       | 185.6 MiB        | 283.7 MiB     | 1.40×       | 1.15×      |
  | 25,000  | 424 MiB    | 173.9 MiB  | 444.3 MiB    | 618.2 MiB   | 243.8 MiB      | 464.5 MiB        | 708.3 MiB     | 1.40×       | 1.15×      |
  | 100,000 | 1,694 MiB  | 691.3 MiB  | 1,777.2 MiB  | 2,468.6 MiB | 971.5 MiB      | 1,858.2 MiB      | 2,829.7 MiB   | 1.41×       | 1.15×      |
  - Index-to-text ratio: **0.41** for the document design, **0.57** for the passage design.
  - Before optimize, files were 1–3% larger.

- **Option variants at 10k documents** (this benchmark; index tables only, plus `%_content` where stated):

  | Variant                                       | Document          | Passage   | Ratio     |
  | --------------------------------------------- | ----------------- | --------- | --------- |
  | detail=full, contentless_delete=1 (file)      | 70.2 MiB          | 99.7 MiB  | 1.42×     |
  | detail=full, content='' + columnsize=0 (file) | 70.1 MiB          | 90.8 MiB  | 1.30×     |
  | detail=column, contentless_delete             | 33.4 MiB          | 94.9 MiB  | **2.84×** |
  | detail=none, contentless_delete               | 12.2 MiB          | 46.1 MiB  | **3.78×** |
  | porter stemmer, contentless_delete            | 65.4 MiB          | 96.3 MiB  | 1.47×     |
  | trigram, contentless_delete                   | 374.8 MiB         | 561.3 MiB | 1.50×     |
  | 2 indexed columns (title, body), stored       | 91.2 MiB `%_data` | n/a       | —         |
  - Trigram took 18.7 s versus 33.1 s to build 10k documents.

- **The SQLite docs' own measurement.** Indexing "a large set of emails (1636 MiB on disk)", the FTS index was 743 MiB with detail=full, 340 MiB with detail=column and 134 MiB with detail=none. That is 45%, 21% and 8% of input. — [SQLite FTS5 docs, detail option](https://www.sqlite.org/fts5.html)
  - This benchmark's document design: 41% / 20% / 7%, consistent with that.
- **A large-scale anecdote.** On 1.73 M patent records, FTS5 "added about 40% to my database size (from ~8GB to ~11GB)", with ~3 ms searches. — [dev.to, 17M patent records](https://dev.to/soytuber/from-30-seconds-to-3-milliseconds-replacing-like-with-fts5-on-17m-patent-records-2bo7)
- **Contentless options.**
  - Contentless (`content=''`) tables return NULL for every column but rowid.
  - `contentless_delete=1` (3.43.0+) supports DELETE and INSERT OR REPLACE, and the docs recommend it over plain contentless.
  - `columnsize=0` drops `%_docsize`, but then xColumnSize "runs much more slowly". On a contentless table it makes xColumnSize return -1, which breaks bm25's length normalisation.
  - — [SQLite FTS5 docs §4.3–4.6](https://www.sqlite.org/fts5.html)
- **Context from other engines.** An inverted index with no positions and no stored documents "is in fact typically much smaller in size than the original data". — [Paul Masurel, tantivy author](https://fulmicoton.com/posts/behold-tantivy-part2)
  - One engine's numbers: positions roughly double index size (5,289 MB → 2,598 MB without positions, on 941 MB of text). — [lucivy 4.2.0](https://pypi.org/project/lucivy/4.2.0/) (third-party engine, not Lucene itself)

### Inferences

- **Sizing formula from the measured coefficients.** Per document, detail=full, unicode61, a single indexed column:
  - Document design ≈ 3,000 tokens × 1.87 + 1,090 pairs × 1.51 + ~10 B ≈ **7.25 KB**.
  - Passage design ≈ 3,000 × 1.87 + 2,500 pairs × 1.51 + 70 rows × 11 B (`%_docsize`) ≈ **10.2 KB**.
  - Text stored: add ~18.2 KB (document) or ~19.0 KB (passage) per document.
  - Scale linearly: measured growth from 10k to 100k was linear within 2%.
- **What to expect for real text:**
  - Real policy text has longer, more repetitive paragraphs. Fewer unique terms per passage push the ratio below 1.4×; very short headings push it up.
  - **Expect 1.3–1.5× for the index and 1.1–1.2× for the database with text stored.**
- **detail=column and detail=none make the passage design relatively much worse (2.8–3.8×).** Positions, which are identical in both designs, are what they drop, leaving only the per-pair cost, which the passage design multiplies.
  - They also forbid phrase and NEAR queries, and slow xInst on content tables.
  - So they are a poor fit for passage-level search.
- **Storing text costs the same in both designs.**
  - External content (FTS reads text from an ordinary table) and FTS-stored content both hold one copy of the text.
  - A **contentless** index plus text kept elsewhere, such as the existing SQLite rows or Gitea, saves the ~1.8 GB of duplicated text at 100k.
  - The trade: `snippet()`/`highlight()` then cannot run, since they need column text (§3).
- **The ~7% saved by porter** (65.4 vs 70.2 MiB) is small. Choose the tokenizer for recall, not size.
- **Trigram costs 5.3× unicode61.** Use it only if substring or LIKE search is required.

### Gaps

- No published FTS5 benchmark compares row-per-passage with row-per-document directly. Only this run exists.
- Sizes on a real Bindersnap corpus, including real headings, lists and tables, are unmeasured.

## 3. Query cost: BM25, snippet() and highlight()

### Takeaway

`ORDER BY rank LIMIT 10` must score **every matching row**, so cost is linear in matching rows:

- **Per matching row:** ~1.2–1.6 µs per document row and ~2.3 µs per passage row on an M1.
- **Common terms:** a common term matches 2.5–2.6× more passage rows than document rows, so the passage design is **~2.5–3.7× slower** for common terms. A term in 90% of 100k documents takes 147 ms for documents versus 542 ms for passages.
- **Rare terms:** both designs take well under 1 ms.
- **Scoped searches:** scoped to one organisation's documents by a rowid range, both designs are low-millisecond.
- **Snippets:** `snippet()` costs ~0.1 ms per long document row and ~0.005 ms per passage row.

### Cited Findings

- **How bm25 works** (`fts5_aux.c`):
  - Once per query it computes per-phrase hit counts with `xQueryPhrase` and the average length with `xColumnTotalSize`.
  - Per row it walks `xInst` and calls `xColumnSize`.
  - It needs every match scored before the top-k is known.
  - — [fts5_aux.c](https://raw.githubusercontent.com/sqlite/sqlite/master/ext/fts5/fts5_aux.c)
- **How snippet() works.** It calls `xColumnText` and tokenizes the whole column to find sentence boundaries, scores windows with `xInst`, then tokenizes the best column again to emit the window. Its cost per result row therefore scales with the length of the row's text. — [fts5_aux.c](https://raw.githubusercontent.com/sqlite/sqlite/master/ext/fts5/fts5_aux.c)
- **Content tables.** Contentless tables return NULL for column values, so `snippet()`/`highlight()` have no text to work on. External content tables read text with `SELECT ... FROM <content> WHERE rowid=?`. — [SQLite FTS5 docs §4.4](https://www.sqlite.org/fts5.html)
- **Measured, top-10 by bm25, median of 15 warm runs, M1** (this benchmark; docs/passages = matching rows):

  | Docs | Query (term frequency) | Matches (docs / passages) | Doc top-10 | Passage top-10 | Doc top-10 + snippet | Passage top-10 + snippet |
  | ---- | ---------------------- | ------------------------- | ---------- | -------------- | -------------------- | ------------------------ |
  | 10k  | df 90%                 | 9,008 / 23,425            | 9.9 ms     | 49.3 ms        | 10.9                 | 50.0                     |
  | 10k  | df 50%                 | 5,005 / 7,114             | 7.7        | 15.0           | 8.7                  | 15.1                     |
  | 10k  | df 5%                  | 500 / 522                 | 0.74       | 1.14           | 1.75                 | 1.16                     |
  | 10k  | df 0.05%               | 5 / 13                    | 0.02       | 0.04           | 0.54                 | 0.09                     |
  | 25k  | df 90%                 | 22,480 / 58,537           | 31.6       | 133.0          | 32.5                 | 132.4                    |
  | 25k  | df 50%                 | 12,491 / 17,431           | 21.0       | 42.7           | 22.1                 | 42.6                     |
  | 25k  | df 5%                  | 1,290 / 1,332             | 2.1        | 3.0            | 3.0                  | 3.1                      |
  | 100k | df 90%                 | 89,822 / 232,931          | 147.0      | 541.9          | 146.5                | 538.5                    |
  | 100k | df 50%                 | 49,969 / 69,760           | 59.5       | 171.8          | 60.5                 | 171.6                    |
  | 100k | df 5%                  | 5,303 / 5,463             | 6.4        | 17.9           | 7.4                  | 18.0                     |
  | 100k | df 0.5%                | 65 / 171                  | 0.12       | 0.32           | 1.37                 | 0.37                     |
  | 100k | 2-term AND             | 2,723 / 51                | 4.8        | 2.5            | 5.7                  | 2.6                      |
  | 100k | 3-term OR              | 52,577 / 75,340           | 64.8       | 187.8          | 66.3                 | 188.0                    |

- **Other measurements** (this benchmark):
  - `count(*)` of matches with no ranking: 0.01–2.3 ms at 100k.
  - `highlight()` of a whole 18 KB document: ~0.07 ms per row.
  - Ranking documents from passages (best passage per document, `GROUP BY rowid>>10`, through a `MATERIALIZED` CTE, because bm25 cannot be used directly inside an aggregate) cost the same as passage top-10: 515 ms at 100k for df 90%.
- **Scoped to one organisation by rowid range, 25k-document index** (`rowid BETWEEN` the organisation's block; this benchmark):

  | Organisation size | df 90% term: doc / passage | df 50%: doc / passage | df 5%: doc / passage |
  | ----------------- | -------------------------- | --------------------- | -------------------- |
  | 200 docs          | 0.73 / 3.1 ms              | 0.39 / 0.63 ms        | 0.09 / 0.10 ms       |
  | 1,000 docs        | 1.8 / 5.2 ms               | 0.87 / 1.7 ms         | 0.13 / 0.16 ms       |
  | 5,000 docs        | 6.2 / 29.8 ms              | 3.0 / 8.2 ms          | 0.45 / 0.73 ms       |

### Inferences

- **The cost driver is matching rows × ~1.5–2.3 µs**, not index size. The worst case is a query of one very common word across the whole corpus.
  - Bindersnap searches are per organisation or per binder.
  - If rowids are allocated in per-organisation blocks, or there is one FTS table per organisation, the number of matching rows is bounded by the organisation's size (hundreds to a few thousand documents). Both designs then stay in single-digit milliseconds.
  - A global 100k-document search on a stop-word-like term is the only case that reaches hundreds of milliseconds.
- **Running on a t4g.medium.** Expect single-thread FTS5 CPU time roughly 1.5–2.5× the M1 figures. This is unmeasured; it rests on the general per-core gap between Graviton2 and M1, and no source was found for FTS5 specifically. Burstable CPU credits matter only if searches run continuously.
- **snippet() is cheaper on passages.**
  - On passages it tokenizes ~250 bytes per row, about 0.005 ms per row.
  - On whole documents it tokenizes ~18 KB per row, about 0.1 ms per row, so ~1 ms per page of 10 results.
  - Either is negligible against ranking a common term.
- **Bounding the worst case:**
  - Reject or warn on single-character or stop-word queries.
  - Rank documents first and cap the candidates.
  - Or use AND for multi-term queries. For AND, the passage design is _faster_ (2.5 ms vs 4.8 ms), because fewer passages than documents contain both terms. With real co-occurrence the gap would be smaller.

### Gaps

- Cold-cache (EBS gp3) timings were not measured. A 100k-document index of ~0.7–1 GB is read through the OS page cache, so first-query latency after a restart is unmeasured.
- No published FTS5 latency benchmark at 1M–10M rows with a matching-row breakdown was found. The passage design at 100k documents is 7.0M rows, and that is this benchmark's own measurement.

## 4. Alternatives: a row per document plus a way to locate the passage

### Takeaway

A **document-grain index for ranking, plus a passage lookup for only the top-N documents**, gets passage-level answers at document-grain storage and CPU cost:

- **Time:** +0.1–5 ms for typical queries, +1–48 ms in the worst common-term case at 100k.
- **Storage:** the passage FTS table, if used for the second stage, costs the full +40% of index. A JavaScript scan of the top documents' stored text costs nothing extra.
- **Offsets:** `xInst` and `fts5vocab` give **token offsets**, not passage numbers, so mapping an offset to a passage needs a stored token-offset table or a re-tokenization.

### Cited Findings

- **xInst** reports, per match, the phrase, the column and "the token offset of the first token of the phrase". With detail=column or none it is slow, and on contentless tables it returns nothing. — [SQLite FTS5 docs §7.2.2](https://www.sqlite.org/fts5.html)
- **The fts5vocab `instance` table** returns one row per term occurrence (term, doc, col, offset). Offset is NULL with detail=column. — [SQLite FTS5 docs §8](https://www.sqlite.org/fts5.html)
- **Measured two-stage costs, top-10 documents, then one best passage each** (this benchmark):

  | Docs | Query      | Doc top-10 alone | + passage FTS, rowid-range lookup per doc | + JS scan of 10 stored bodies |
  | ---- | ---------- | ---------------- | ----------------------------------------- | ----------------------------- |
  | 10k  | df 50%     | 7.7 ms           | 9.4 ms                                    | 8.1 ms                        |
  | 25k  | df 90%     | 31.6             | 44.5                                      | 32.2                          |
  | 100k | df 90%     | 147.0            | 195.6                                     | 150.1                         |
  | 100k | df 50%     | 59.5             | 74.1                                      | 60.1                          |
  | 100k | df 5%      | 6.4              | 7.9                                       | 6.8                           |
  | 100k | df 0.05%   | 0.10             | 0.42                                      | 0.49                          |
  | 100k | 2-term AND | 4.8              | 21.0                                      | 5.2                           |
  - The passage FTS lookup was `MATCH ? AND rowid BETWEEN d*1024 AND d*1024+1023 ORDER BY rank LIMIT 1`.
  - The JS scan split each body on blank lines and counted query-term substrings per paragraph.
  - In each two-stage pair, the document and passage designs are compared directly.

- **Why the AND row costs 21 ms.** The passage FTS lookup walks the common term's doclist inside each document's rowid range. Here few passages matched both terms, so each per-document lookup found nothing cheaply. — this benchmark

### Inferences

- **Option A: document FTS only (smallest, fastest ranking).**
  - Locate the passage by re-tokenizing or scanning only the top-N documents' text in the API, from external content or a plain table of passages keyed by (doc_id, passage_no).
  - Cost: 0 extra index bytes, ~0.03–0.3 ms per document examined.
  - The plain passage table duplicates text only if the text is not already stored elsewhere.
- **Option B: document FTS for ranking, plus a contentless passage FTS for the second stage.**
  - Same index storage as the full passage design (+40% index).
  - It gives true bm25 at passage grain for the second stage, and it handles AND queries whose terms co-occur in the document but not one passage.
- **Option C: passage FTS only.**
  - +40% index and +15% total storage.
  - ~2.5–3.7× slower on common terms over the whole corpus.
  - Natively returns passages, with cheap snippets. Document ranking can come from the best passage (`GROUP BY rowid>>10`) at no extra cost.
  - Document-level bm25 is lost: a document's score becomes its best passage's score, not a whole-document score.
- **Option D: map xInst offsets to passages in a custom auxiliary function.**
  - Needs a per-document array of passage start offsets in tokens.
  - That costs ~70 varints, about 140 B per document, in a side table: much cheaper than Option B.
  - But it requires writing a C auxiliary function, which bun:sqlite cannot register from JS. Built-in snippet() and highlight() do not return passage numbers.
  - Not worth it given Option A's measured cost.
- **The user's worry, quantified.** "Much more expensive" holds only for detail=column or none (2.8–3.8×) and for unscoped common-term queries (2.5–3.7× CPU). With detail=full and organisation-scoped queries, the passage design costs ~1.4× the index bytes, ~1.15× the total database, ~1.25–1.55× the build CPU, and ~1–3 ms more per query.

### Gaps

- Not measured: a custom C auxiliary function, and fts5vocab `instance` lookups restricted to the top-N documents (an fts5vocab instance table has no efficient per-document filter).

## 5. Writes: optimize, automerge, crisismerge, WAL, and updating one document

### Takeaway

Building the whole index is cheap in both designs:

- **Build:** ~70–90 s for 100k documents on an M1. The passage design costs ~1.25–1.55× the CPU.
- **optimize:** 7–11 s at 100k, and it reclaims only 1–3%.
- **Replacing one document:** ~0.4 ms for the document design versus ~1.0 ms for the passage design, the latter being a delete and re-insert of ~70 rows.
- **Merging:** the default automerge keeps segment counts low, so optimize is optional.

### Cited Findings

- **automerge:** default 4, maximum 16, 0 disables. FTS5 "begins to merge b-trees together once there exist M or more b-trees with the same level". — [SQLite FTS5 docs §6](https://www.sqlite.org/fts5.html)
- **crisismerge:** default 16. When it is reached, "all b-trees on the level are immediately merged", so that statement can be slow. — [SQLite FTS5 docs §6](https://www.sqlite.org/fts5.html)
- **optimize** merges everything into one b-tree and "can take a long time". `merge` with -N, then N repeatedly, does the same work in increments. — [SQLite FTS5 docs §6](https://www.sqlite.org/fts5.html)
- **Delete behaviour:**
  - Old entries remain until merged, unless `secure-delete=1`, whose tables pre-3.42.0 versions cannot read.
  - `deletemerge` (default 10%) triggers merges on contentless-delete tables by tombstone share.
  - — [SQLite FTS5 docs §6](https://www.sqlite.org/fts5.html)
- **Measured build and optimize** (this benchmark; 100 documents per commit, WAL):

  | Docs | Doc insert | Passage insert | Doc optimize | Passage optimize | Size before → after optimize+VACUUM (doc / passage) |
  | ---- | ---------- | -------------- | ------------ | ---------------- | --------------------------------------------------- |
  | 10k  | 4.2 s      | 6.4 s          | 0.6 s        | 1.1 s            | 250.8→247.7 / 287.3→283.7 MiB                       |
  | 25k  | 11.6 s     | 18.4 s         | 1.7 s        | 2.7 s            | 624.6→618.2 / 713.4→708.3 MiB                       |
  | 100k | 71.4 s     | 88.4 s         | 7.4 s        | 11.2 s           | 2476→2469 / 2838→2830 MiB                           |

- **Measured one-document replacement**, 50 replacements on an existing index, one transaction each, synthetic short replacement text:
  - 100k: document 0.41 ms median (p90 2.7 ms); passage 1.01 ms median (p90 2.9 ms).
  - 10k: document 0.43 ms; passage 0.82 ms.
  - Each replacement added ~1–3 `%_idx` rows, a sign of new level-0 segments.
  - — this benchmark
- **Realistic per-document cost.** From the full builds, a real 3,000-word document costs ~0.4–0.7 ms (document) versus ~0.6–0.9 ms (passage) to index. — this benchmark

### Inferences

- **The publish path.**
  - One publish replaces one document: about 1 ms of FTS work in either design, invisible next to a Gitea merge.
  - A full rebuild from Gitea (a derived index must be rebuildable, per ADR 0004) takes ~1.5–3 minutes at 100k on a t4g, assuming 1.5–2.5× the M1 time. Do it in batches of 100–1,000 documents per transaction, so a WAL file and a Litestream snapshot never hold a multi-GB transaction.
- **Litestream.** It replicates WAL frames, so write volume per publish matters more than index size.
  - A document replacement writes a level-0 segment of ~7–10 KB plus merge rewrites.
  - The passage design writes ~1.4× the bytes of the document design.
  - Both are trivial.
  - An occasional `optimize` (or incremental `merge`) rewrites the whole index (0.7–1 GB at 100k) through the WAL. Litestream would replicate that, so prefer incremental `merge` with small N, or no optimize at all: it saved only 1–3% here.

### Gaps

- Long-run fragmentation under thousands of incremental replacements was not measured (only 50).
- Litestream's replication cost for an optimize was not measured.

## 6. Memory on a shared 4 GiB host

### Takeaway

FTS5 query memory is small: a common term's whole doclist is under 1 MB even at 100k documents, and the benchmark process stayed at ~82 MB RSS. The index (0.7–1.0 GB at 100k) is served from the OS page cache, so memory is a concern only for latency after the cache is evicted, not for correctness.

### Cited Findings

- **This SQLite build's defaults:**
  - `DEFAULT_CACHE_SIZE=2000` (pages), `DEFAULT_MMAP_SIZE=0`, `MAX_MMAP_SIZE=1073741824`, `DEFAULT_PAGE_SIZE=4096`.
  - Read from `PRAGMA compile_options` on SQLite 3.51.0 under Bun on macOS. The Linux build bundled in Bun may differ.
  - — this benchmark
- **Measured:** process RSS after running all queries and updates on the 100k-document databases was 82 MB. — this benchmark
- **Measured:** the most common term (90% of 100k documents) had 247k occurrences in 89,822 documents, or 232,817 passages. — this benchmark (fts5vocab)

### Inferences

- **Doclist size by the §1 coefficients:**
  - The most common term's doclist is ≈ 247k × 1.87 + 90k × 1.51 ≈ **0.6 MB** (document design) or ≈ 247k × 1.87 + 233k × 1.51 ≈ **0.8 MB** (passage design).
  - A query therefore touches at most a few MB of pages. Rare terms touch one or two 4 KB pages.
- **Keeping it in cache.**
  - Working set for hot queries is tens of MB.
  - Keeping the whole index cached would need ~0.7 GB (document) or ~1.0 GB (passage) at 100k, competing with Gitea's and Bun's memory for page cache.
  - At 10k–25k documents (70–245 MB of index) this is no concern.
- **Settings.** Raising `cache_size` or setting `mmap_size` is optional. mmap would let the OS share pages rather than double-buffering, at the cost of SIGBUS risk on I/O errors (general SQLite guidance, not verified here).

### Gaps

- No measurement on a t4g.medium with Gitea running. No cold-start latency from gp3 (3,000 IOPS baseline) after page-cache eviction.

## 7. Large-scale FTS5 benchmarks (1M–10M rows)

### Takeaway

Public FTS5 data at million-row scale is anecdotal. This benchmark's passage table at 100k documents (7.03M rows, 971 MiB of index) behaved linearly from 0.7M to 7M rows, with no sign of a non-linear cliff in size, build time or query time.

### Cited Findings

- **1.73 M patent records:** +40% database size (~8 GB → ~11 GB); searches "in 3 milliseconds" versus 10–30 s with LIKE. — [dev.to](https://dev.to/soytuber/from-30-seconds-to-3-milliseconds-replacing-like-with-fts5-on-17m-patent-records-2bo7)
- **Index bloat cautions:**
  - A SQLite forum thread where an index ballooned turned out to be binary data ingested as text.
  - Blogs note that high-cardinality tokens (GUIDs, URLs) inflate indexes.
  - — [SQLite Forum](https://sqlite.org/forum/info/a56bfc92a7c41131); [loke.dev, FTS5 ranked search internals](https://loke-dev-lokedevs-projects.vercel.app/blog/sqlite-fts5-ranked-search-internals)
- **Prefix indexes add size.** In a Mozilla application-services ADR, 10,000 items took 2,896 KB without a prefix index and 3,797 KB with `prefix='1 2 3'` (+31%). — [Mozilla ADR 0008](https://searchfox.org/mozilla-mobile/source/application-services/docs/adr/0008-fts-prefix-config.md)
- **Scaling, measured across 10k → 25k → 100k documents** (0.70M → 1.76M → 7.03M passage rows):
  - Passage index: 98.1 → 243.8 → 971.5 MiB, i.e. 9.81 → 9.75 → 9.71 KiB per document.
  - Common-term top-10: ~2.1–2.3 µs per matching passage row at every scale.
  - — this benchmark

### Inferences

- **At 7M rows FTS5 is comfortably in range**: sub-GB index, linear costs. Nothing suggests the row count itself, as distinct from token count, causes trouble at this scale.
- **A prefix index**, for type-ahead, would add ~30% to either design.

### Gaps

- No primary benchmark found at 10M+ rows. No published Graviton numbers for FTS5.

## Summary for the report writer

**Cheaper:** the document design, by these factors:

| Measure                                      | Passage design ÷ document design |
| -------------------------------------------- | -------------------------------- |
| FTS index bytes (detail=full)                | 1.40×                            |
| Whole database with text stored              | 1.15×                            |
| Index with detail=column / detail=none       | 2.8× / 3.8×                      |
| Build CPU                                    | 1.25–1.55×                       |
| Update CPU per document                      | ~2× (but ~1 ms)                  |
| Query CPU, organisation-scoped (≤1,000 docs) | 1.2–4× (0.1–5 ms absolute)       |
| Query CPU, unscoped common terms at 100k     | 2.5–3.7× (147 vs 542 ms on M1)   |

**Absolute sizes, index only, detail=full:**

| Docs | Document design | Passage design | + stored text  |
| ---- | --------------- | -------------- | -------------- |
| 10k  | 70 MiB          | 98 MiB         | +178–186 MiB   |
| 25k  | 174 MiB         | 244 MiB        | +444–465 MiB   |
| 100k | 691 MiB         | 972 MiB        | +1.78–1.86 GiB |

**Passage results at document cost:** rank at document grain, then find the passage in only the top 10 documents. Doing it in JavaScript over stored text adds ~0.1–3 ms. A rowid-ranged passage FTS lookup adds ~0.3–48 ms and costs the passage index's bytes.
