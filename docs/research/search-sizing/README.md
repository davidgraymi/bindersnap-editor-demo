# Search sizing research

Research behind [ADR 0007](../../adr/0007-search.md), done 2026-11-04: what a
full-text index costs one row per passage against one row per document, and
what semantic search would cost on the t4g.medium or off it.

- [`report.md`](report.md) — the findings and the recommended design.
- [`notes/`](notes/) — the four research notes the report is written from, with
  their sources.
- [`bench/`](bench/) — the FTS5 benchmark the size and timing figures come
  from. Its numbers were measured on an Apple M1, not on Graviton; the report
  lists what still has to be run on a real t4g.medium.

## Running the benchmark

The scripts build synthetic policies from the repository's own Markdown, so
pass the repository root. Databases go to `$FTS5BENCH_DIR` (default
`/tmp/fts5bench/db`), which must exist; the 100k-document runs need about 8 GB.

```bash
mkdir -p /tmp/fts5bench/db
# Build: documents, then variants (level_detail_content_tokenizer)
bun docs/research/search-sizing/bench/bench.ts . 10000 doc1_full_stored_u61,pass_full_stored_u61
bun docs/research/search-sizing/bench/query.ts 10000          # whole-corpus query latency
bun docs/research/search-sizing/bench/scope.ts                # one organization (needs the 25000 build)
bun docs/research/search-sizing/bench/vocab.ts                # bytes per token and per pair (needs the 10000 contentless build)
```

Delete the databases when you are done.
