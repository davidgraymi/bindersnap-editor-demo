# Vector storage in SQLite, quantization, and hybrid (BM25 + vector) ranking on a t4g.medium

Scope: storing and searching embeddings inside SQLite from Bun on a 2 vCPU Graviton2 / 4 GiB / 30 GB gp3 host, at 10k / 25k / 100k documents (50k to 10M vectors), and fusing that search with FTS5 BM25.

Labels used below: **[vendor]** = number published by the tool's own author or company; **[indep]** = third-party; **[inferred]** = my own arithmetic or extrapolation, not measured.

## sqlite-vec: status, vec0, brute-force KNN performance, filtering, ANN, Bun loading; and the alternatives

### Takeaway

sqlite-vec is still pre-v1. The latest stable release is v0.1.9 (31 Mar 2026). The v0.1.10 alphas (Mar–May 2026) add opt-in ANN indexes: `rescore` (binary or int8 coarse pass, then float rescoring), `diskann`, and an experimental `ivf` that is not enabled. The default `vec0` is brute force. Its published speed is about 590 ms per 1M × 1024-dim float vectors and about 92–101 ms per 1M with the bit `rescore` index, on an Apple M4 [vendor]. Partition keys, which pre-filter before any distance is computed, are the main lever for a multi-tenant product: each organization's search then scans only its own vectors.

### Cited Findings

**Status and versions**

- The README says "`sqlite-vec` is a pre-v1, so expect breaking changes!" It stores float, int8 and binary vectors in `vec0` virtual tables, plus "metadata, auxiliary, or partition key columns". The source tree includes `sqlite-vec-ivf.c`, `sqlite-vec-diskann.c`, `sqlite-vec-rescore.c` and `benchmarks-ann/`. — [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- v0.1.9 (31 Mar 2026) is marked Latest. v0.1.7 ("sqlite-vec is back") added proper DELETE that reclaims space (about once ~1024 vectors in a chunk are deleted) and `>`, `>=`, `<`, `<=` constraints on the distance column for pagination. v0.1.10-alpha.1 is the "Initial alpha release of `sqlite-vec` with new ANN indexes: rescore, ivf (experimental, not enabled), and DiskANN." alpha.2 adds FTS5-style "insert commands" for rescore/DiskANN parameters, and warns that a DiskANN delete fix "causes DELETEs to be quite expensive". alpha.4 (18 May) fixes ALTER TABLE RENAME on ivf/diskann tables. Year inferred as 2026 from asset timestamps. — [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)
- The `rescore` index (PR #276, merged March 2026) is compiled behind `SQLITE_VEC_ENABLE_RESCORE`. Its syntax is `float[1024] distance_metric=cosine indexed by rescore(quantizer=bit, oversample=8)`. — [PR #276](https://github.com/asg017/sqlite-vec/pull/276); syntax summary via [search result for PR #276](https://github.com/asg017/sqlite-vec/pull/276)
- The DiskANN index (PR #278) is an incrementally built Vamana graph with binary-compressed neighbor vectors. It needs no training step. Its parameters are `n_neighbors`, `search_list_size_insert`, and `search_list_size_search` (which can be set per query). Example: `indexed by diskann(neighbor_quantizer=binary, n_neighbors=48, search_list_size_insert=96)`. — [PR #278](https://github.com/asg017/sqlite-vec/pull/278)
- IVF is PR #277, "Add new experimental IVF ANN INdex". Its tests are skipped unless a build flag is set. — [PR #276 page / commit notes](https://github.com/asg017/sqlite-vec/pull/276)

**Published brute-force and ANN benchmarks [vendor, all on Apple Silicon]**

- v0.1.0 post, Mac M1 mini 8 GB. sift1m (1M × 128 float, k=20): sqlite-vec "static" 17 ms; vec0 33–35 ms; faiss 10 ms; duckdb 46 ms; usearch exact 56 ms; numpy 136 ms. GIST (500k × 960): static 41 ms, vec0 87–89 ms. — [Alex Garcia, sqlite-vec v0.1.0](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)
- Same post, vectors on disk. 100k float: 3072-dim 214 ms, 1536-dim 105 ms, 1024/768/384/192-dim "all below 75ms". 100k bit at 3072-dim: 11 ms. 1M float: 3072-dim 8.52 s, 192-dim 192 ms. 1M bit: 124 ms. The author's target is 100 ms, and he puts the practical brute-force limit "in the 100's of thousands" of vectors. — [Alex Garcia, sqlite-vec v0.1.0](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)
- PR #276, MacBook Pro M4, 1M NYT headlines, mxbai-embed-large-v1 (1024-dim), Recall@10:

  | Config                     | Size    | Query  | Recall@10 |
  | -------------------------- | ------- | ------ | --------- |
  | flat float                 | 3.85 GB | 590 ms | 1.0       |
  | rescore int8, oversample=2 | 5.28 GB | 225 ms | 1.0       |
  | rescore bit, oversample=8  | 4.55 GB | 101 ms | 0.988     |
  | rescore bit, oversample=4  | 4.55 GB | 92 ms  | 0.962     |

  A rescore index keeps the full float vectors _and_ the quantized copy, so it is larger on disk than flat. The author says to take the numbers "with a grain of salt" because models quantize differently. — [PR #276](https://github.com/asg017/sqlite-vec/pull/276)

- PR #278, same dataset and machine. DiskANN R=48 L=64: insert 55 min 21 s (121× slower than flat), 11.94 GB (3.1× bigger), 33.6 ms query, recall 0.980. DiskANN R=40 L=48: 42 min 17 s, 10.03 GB, 4.6 ms, recall 0.954. Pruning "is _slow_ … it gets slower the larger the database gets". The "<1ms" queries the author saw came only from a warm page cache. — [PR #278](https://github.com/asg017/sqlite-vec/pull/278)
- No published sqlite-vec benchmark on Graviton or any ARM Linux server was found. A benchmark-harness PR (#273) adds brute-force float/int8/bit baselines and mentions NEON code in `distance_cosine_float()`, but publishes no numbers. — [PR #273](https://github.com/asg017/sqlite-vec/pull/273/files)

**Filtering (metadata, partition keys, auxiliary columns)**

- **Metadata columns** (v0.1.6, Nov 2024) can be `TEXT`, `INTEGER`, `FLOAT` or `BOOLEAN`, up to 16 per table. Allowed operators are `=`, `!=`, `<`, `<=`, `>`, `>=` and `IN` (on INTEGER/TEXT). `LIKE`/`GLOB`/`REGEXP`/NULL are not supported. They are evaluated row by row during the KNN scan, so they do not reduce the work. — [vec0 docs](https://alexgarcia.xyz/sqlite-vec/features/vec0.html); [metadata release post](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html)
- **Partition keys** are TEXT or INTEGER, up to 4 per table. An `=` constraint restricts the scan to that shard ("pre-filter rows before comparing any vectors"). The docs say each value should hold "~100s of vectors" and warn about over-sharding. `IN (...)` on partition keys was _not_ supported as of the v0.1.6 post. The release post's example ran "3x faster" with a partition key. — same two sources
- **Auxiliary columns** (`+col`) are unindexed and stored for SELECT only, never used in the KNN WHERE clause. — [vec0 docs](https://alexgarcia.xyz/sqlite-vec/features/vec0.html)
- Query form: `WHERE emb MATCH :q AND k = 20 AND org_id = :org`. — [vec0 docs](https://alexgarcia.xyz/sqlite-vec/features/vec0.html)

**Loading in Bun**

- `Database.loadExtension(path, entryPoint?)` exists in bun:sqlite. On macOS, Bun uses Apple's system SQLite, which disables extension loading (Bun uses it for "~50% performance"), so you must call `Database.setCustomSQLite('/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib')` first. — [Bun reference: loadExtension](https://bun.com/reference/bun/sqlite/Database/loadExtension)
- `setCustomSQLite` must run before any Database is opened. Otherwise you get "This build of sqlite3 does not support dynamic extension loading", or the call is silently ignored. The fix is a lazy `await import("bun:sqlite")` after setting the path. — [opencode-mem issue #34](https://github.com/tickernelz/opencode-mem/issues/34); example of the pattern in [qmd db.ts](https://gitcode.com/GitHub_Trending/qmd1/qmd/blob/main/src/db.ts)
- On Linux, Bun ships its own SQLite, and `loadExtension` works without that step (implied by the Bun docs scoping the requirement to macOS). sqlite-vec's npm package publishes per-platform binaries. v0.1.8 fixed an npm install problem (#272). — [Bun reference](https://bun.com/reference/bun/sqlite/Database/loadExtension); [releases](https://github.com/asg017/sqlite-vec/releases)

**Alternatives**

- **libSQL / Turso native vectors** need no extension. Columns are `F32_BLOB(N)` (also F16/F8/F1 variants); the index is `CREATE INDEX … ON t(libsql_vector_idx(col, 'metric=cosine'))`; queries use the `vector_top_k(idx, q, k)` table function, which returns rowids. The algorithm is LM-DiskANN, which returns "slightly suboptimal neighbors" on large tables. Tuning: `max_neighbors` (default 3√D) and `search_l` (default 200). Older docs called it a "technical preview". **This requires the libSQL fork of SQLite, not bun:sqlite.** — [Turso AI & embeddings docs](https://docs.turso.tech/features/ai-and-embeddings); [Turso DiskANN blog](https://turso.tech/blog/approximate-nearest-neighbor-search-with-diskann-in-libsql)
- **sqlite.org "vec1"**: SQLite's own project has a vec1 ANN extension document, with IVFADC and an open question about HNSW/DiskANN on its roadmap. — [sqlite.org vec1](https://sqlite.org/vec1/doc/trunk/doc/vec1.md)
- sqlite-vss, usearch, hnswlib-node and LanceDB were not researched in depth in this pass (see Gaps). In the v0.1.0 benchmark, usearch exact search was 56 ms on sift1m vs 33 ms for vec0. — [Alex Garcia v0.1.0](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)

### Inferences

- vec0 flat float measured on the M4: 590 ms / 1M × 4096 B ≈ 0.14 ns/byte, about 7 GB/s effective. The bit rescore index (128 B/vector) still costs ~92 ms per 1M, so there is a **per-vector floor of roughly 90 ns on an M4**, and quantizing below ~128 B/vector stops paying linearly. Graviton2 (Neoverse N1, 2.5 GHz) single-thread is meaningfully slower than an M4. **I assume a 2–4× slowdown [inferred, not measured]**: about 0.45–0.9 s per 1M float-384 vectors, 0.2–0.45 s per 1M int8-384, and 0.15–0.4 s per 1M bit. sqlite-vec runs a query on one thread.
- DiskANN in sqlite-vec is not a fit for this host today. It is alpha, builds about 100× slower than flat (42–55 min for 1M on an M4, so likely hours on Graviton2), makes the database about 3× bigger, has expensive deletes, and is fast only from a warm page cache, which 4 GiB shared RAM cannot promise for multi-GB tables.
- **Partitioning by organization (`org_id integer partition key`) is the decisive design choice.** Every search in Bindersnap is scoped to the binders one person can read, which belong to one organization. A KNN query then scans only that organization's vectors, so latency depends on the largest organization's corpus, not on the 10k–100k total. A binder filter inside the organization can be a metadata column (`binder_id IN (...)`), since `IN` is not available on partition keys.
- Cross-org search (the `/-/documents` library spans organizations) would need one KNN per organization, or a UNION of per-partition queries.

### Gaps

- No independent or Graviton/ARM Linux benchmark of sqlite-vec was found. The 2–4× M4→Graviton2 factor is a guess and should be measured with `benchmarks-ann/` on the real instance.
- I did not verify whether sqlite-vec's int8 and Hamming kernels have NEON paths (only float cosine is mentioned), so int8 could be slower than its byte count suggests on ARM.
- I did not confirm that the prebuilt npm `sqlite-vec-linux-arm64` binary is compiled with `SQLITE_VEC_ENABLE_RESCORE` / DiskANN, or whether you must build from source to get the ANN indexes.
- sqlite-vss deprecation status, hnswlib-node, usearch and LanceDB embedded were not researched in this pass.

## Quantization: bytes per vector, Matryoshka truncation, retrieval quality loss

### Takeaway

int8 keeps ~97% of retrieval quality with no rescoring and ~99% with it. Binary keeps ~92.5% without rescoring and ~96% with float rescoring. Those figures come from mixedbread/Hugging Face on a 1024-dim model [vendor]. Matryoshka truncation is much more expensive in quality than quantization (1024→256 keeps 86%, binary at 256 keeps ~80%), so for a 384-dim model the best combination is "binary coarse scan + float32 rescore" at full dimension, not truncation.

### Cited Findings

- Hugging Face / mixedbread, mxbai-embed-large-v1 (1024-dim), MTEB retrieval NDCG@10. int8 without rescoring keeps 97% (52.79 vs 54.39). int8 with a rescore multiplier of 4–5 keeps ~99%. Binary without rescoring keeps 92.53%. Binary with float rescoring keeps 96.45% ("Just doing the rescoring without retrieving more samples pushes the performance to 96.45%"), and multipliers above 1 add nothing for binary. CPU exact-search speedup vs float32: int8 mean 3.66× (2.99–4.8×); binary mean 24.76× (15.05–45.8×). — [HF blog: Embedding Quantization](https://huggingface.co/blog/embedding-quantization) [vendor]
- At 1024-dim, a vector is 4,096 B as float32, 1,024 B as int8, and 128 B as binary. The cost example for 250M vectors is 953.67 GB / $3,623 a month (float32), 238.41 GB / $905 (int8), and 29.80 GB / $113.25 (binary). — [HF blog](https://huggingface.co/blog/embedding-quantization)
- Matryoshka + binary (mixedbread, mxbai-embed-large-v1, 13 BEIR datasets in MTEB, NDCG@10), retention vs float32 at 1024 dims:

  | Dims | float32 | binary | binary bytes |
  | ---- | ------- | ------ | ------------ |
  | 1024 | 100%    | 96.46% | 128          |
  | 512  | 95.22%  | 90.76% | 64           |
  | 256  | 86.01%  | 79.52% | 32           |
  | 128  | 67.34%  | 60.31% | 16           |

  int8 was not evaluated in that post. — [mixedbread: binary MRL](https://www.mixedbread.com/blog/binary-mrl) [vendor]

- sqlite-vec measured recall, not NDCG, of its own rescore index vs flat (1M × 1024): int8 oversample=2 gives 1.0; bit oversample=8 gives 0.988; bit oversample=4 gives 0.962. — [PR #276](https://github.com/asg017/sqlite-vec/pull/276) [vendor]
- sqlite-vec provides `vec_quantize_binary()` for a manual bit column plus rescore, and notes that some models are trained to survive binary quantization. — [sqlite-vec binary-quant guide](https://raw.githubusercontent.com/asg017/sqlite-vec/main/site/guides/binary-quant.md)
- A small 384-dim model: bge-small-en-v1.5 is 33.4M params and scores 51.68 on MTEB retrieval (15 tasks). bge-base (768) scores 53.25 and bge-large (1024) 54.29. — [BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) [vendor]

### Inferences

- Bytes per vector [inferred, arithmetic]: **384-dim**: float32 1,536 B; float16 768 B; int8 384 B; binary 48 B. **768-dim**: float32 3,072 B; float16 1,536 B; int8 768 B; binary 96 B. **768→256 Matryoshka**: float32 1,024 B; binary 32 B. **768→128**: float32 512 B; binary 16 B. sqlite-vec's own overhead is small: 1M × 1024 float was 3.85 GB (GiB) against 3.81 GiB raw.
- The quality retention figures come from a 1024-dim model trained with quantization in mind. A 384-dim model has less redundancy, so it will probably lose _more_ to binary. Treat 92–96% as an upper bound for bge-small/MiniLM-class models until it is measured on our own documents.
- bge-small at 384-dim gives up only ~2.6 MTEB-retrieval points to bge-large (51.68 vs 54.29) for a quarter of the bytes. That is a much better trade than truncating a large model to 256 dims (−14%).
- Recommended default: 384-dim model; store float32 for rescoring, plus a bit index (`indexed by rescore(quantizer=bit, oversample=8)`, or a manual bit column); keep int8 as the fallback if bit recall on our documents is poor.

### Gaps

- No int8 + Matryoshka retention numbers, and no published binary-quantization retention for 384-dim models (bge-small, all-MiniLM-L6, e5-small).
- Cohere's int8/binary embedding posts were not fetched in this pass.

## Compute sizing: storage, memory and brute-force latency at 10k/25k/100k documents

### Takeaway

At 384 dims, one vector per document or ~8 chunks per document fits comfortably on this host in any quantization: under 310 MB float32 at 25k documents, and ~1.2 GB float32 at 100k documents × 8. Sixty passages per document (600k–6M vectors) makes float32 brute force too slow and too big for 4 GiB shared RAM (0.9–9.2 GB). It is workable only with a bit coarse scan plus float rescore, and above all with per-organization partitioning.

### Cited Findings

- Anchor measurements: flat float 590 ms per 1M × 1024 on M4; bit rescore 92–101 ms per 1M; int8 rescore 225 ms per 1M. — [PR #276](https://github.com/asg017/sqlite-vec/pull/276) [vendor]
- 100k float vectors at ≤1024 dims answer in under 75 ms on an M1 from disk; 1M × 192 float in 192 ms; 1M bit in 124 ms. — [Alex Garcia v0.1.0](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html) [vendor]

### Inferences

All figures below are **[inferred]**. Storage is raw bytes (sizes in MB = 10^6 B). Latency assumes a warm page cache, one query thread, and the guessed 2–4× Graviton2 slowdown applied to the M4 per-1M rates: float32-384 0.45–0.9 s, int8-384 0.2–0.45 s, bit 0.15–0.4 s per 1M vectors. Bit latency excludes the rescore step, which reads only k × oversample (~80–160) float rows and costs a few ms.

| Docs | Layout     | Vectors | float32 MB | int8 MB | bit MB | float32 ms  | int8 ms     | bit ms    |
| ---- | ---------- | ------- | ---------- | ------- | ------ | ----------- | ----------- | --------- |
| 10k  | (a) 1/doc  | 10k     | 15         | 3.8     | 0.5    | 5–9         | 2–5         | 2–4       |
| 25k  | (a)        | 25k     | 38         | 9.6     | 1.2    | 11–23       | 5–11        | 4–10      |
| 100k | (a)        | 100k    | 154        | 38      | 4.8    | 45–90       | 20–45       | 15–40     |
| 10k  | (b) 8/doc  | 80k     | 123        | 31      | 3.8    | 36–72       | 16–36       | 12–32     |
| 25k  | (b)        | 200k    | 307        | 77      | 9.6    | 90–180      | 40–90       | 30–80     |
| 100k | (b)        | 800k    | 1,229      | 307     | 38     | 360–720     | 160–360     | 120–320   |
| 10k  | (c) 60/doc | 600k    | 922        | 230     | 29     | 270–540     | 120–270     | 90–240    |
| 25k  | (c)        | 1.5M    | 2,304      | 576     | 72     | 680–1,350   | 300–680     | 230–600   |
| 100k | (c)        | 6M      | 9,216      | 2,304   | 288    | 2,700–5,400 | 1,200–2,700 | 900–2,400 |

- **Memory.** Brute force reads every vector in the searched partition on every query, so the working set is the scanned table size, held in the OS page cache, not in a Bun heap. On a 4 GiB host shared with Gitea, the API and others, keep the _scanned_ vector data under roughly 0.5–1 GB. Rescore keeps float32 on disk, read only for the shortlist, so with a bit index only the bit column has to be hot: 288 MB even at 6M vectors.
- **Cold reads.** If a float32 table falls out of cache, each query becomes a gp3 sequential read. At the gp3 baseline of 125 MiB/s (AWS's documented baseline; that docs page was not fetched in this pass), 1.2 GB is ~10 s and 9.2 GB is ~70 s. Brute force over float32 at layout (c) is not viable on this host.
- **Disk.** A rescore index stores float32 _plus_ the quantized copy. At 100k × 60 that is ~9.5 GB of the 30 GB gp3 volume, before FTS5, Gitea repositories, backups and the WAL. Layout (b) at 100k documents is ~1.3 GB.
- **Partitioning changes the latency picture.** With an `org_id` partition key, latency follows the largest organization. Example: a 2,000-document organization at layout (b) is 16k vectors, ~3–15 ms in any format; at layout (c) it is 120k vectors, ~20–110 ms. Even the 100k-document total is acceptable if no single organization approaches it.
- Chunking advice for the writer: layout (b), ~8 chunks of ~512 tokens, is the sweet spot. Float32 brute force stays under ~200 ms up to 25k documents, and bit + rescore covers 100k documents. Layout (c) only makes sense with bit + rescore + partitioning.
- Query embedding (running the 384-dim model on the query on CPU) adds its own latency and is outside this note.

### Gaps

- Every Graviton2 latency here is an extrapolation from Apple M-series numbers. Run `benchmarks-ann/` on a t4g.medium at 384 dims with float/int8/bit before committing.
- sqlite-vec's chunked storage layout and per-row overhead at 48 B bit vectors were not measured, so the per-vector floor (~90 ns on M4) may dominate bit scans even more than assumed.

## Hybrid search: RRF of FTS5 BM25 and vector KNN, published gains, cost, rerankers

### Takeaway

RRF (score = Σ 1/(k + rank)) is the safe default because it needs no score normalization or tuning data. Elastic found it "either better or similar to BM25 alone" on every BEIR dataset it tested, with average NDCG@10 about 18% above BM25 [vendor]. Alex Garcia's sqlite-vec post gives a ready SQL pattern: a FULL OUTER JOIN of the FTS5 and vec0 CTEs. A MiniLM-L6 cross-encoder is light enough to rerank the top 20–50 on CPU; bge-reranker-v2-m3 (568M params) probably is not, on a shared 2 vCPU host.

### Cited Findings

- **RRF origin.** Cormack, Clarke & Büttcher, SIGIR 2009: RRF "yields better results than any individual system, and better results than the standard Condorcet Fuse method" on TREC runs and LETOR 3. — [Google Research listing](https://research.google/pubs/pub36196/); [Webis anthology](https://ir.webis.de/anthology/2009.sigirconf_conference-2009.146/). The commonly used k=60 is attributed to this paper by Elastic ("The original RRF paper suggests k=60"). I did not verify it in the PDF. — [Elastic hybrid blog](https://www.elastic.co/search-labs/blog/improving-information-retrieval-elastic-stack-hybrid)
- **Elastic, BEIR subset** (9 datasets: touche2020, scidocs, nq, hotpotqa, fiqa, dbpedia-entity, arguana, trec-covid, nfcorpus; ES 8.8; July 2023). RRF of BM25 + ELSER (a learned _sparse_ model, not dense) improves average NDCG@10 by 1.4% over ELSER alone and 18% over BM25 alone. A linear combination with per-dataset tuned weights gives +6% over ELSER and +24% over BM25, but the best weight is "model specific", about 40 labelled queries are needed to beat RRF, and the weight does not transfer. RRF is "either better or similar to BM25 alone" on all datasets. The best k was 20, with N (depth) = 1000, but the spread between best and worst parameters was "only about 5%". Hybrid helps most when the two retrievers are similarly accurate. — [Elastic: hybrid retrieval](https://www.elastic.co/search-labs/blog/improving-information-retrieval-elastic-stack-hybrid) [vendor]
- Secondary claims, not checked against primary sources: OpenSearch normalized hybrid +12.08% NDCG@10 over BM25 on seven BEIR datasets; on the WANDS e-commerce set, RRF added only ~1.3–1.7%. — [search summary incl. ninadpathak blog](https://ninadpathak.pages.dev/blog/hybrid-search-bm25-vector-search/) [indep, unverified]
- Vespa: a ColBERT + BM25 hybrid beat other methods on 12 of 13 BEIR datasets. It also notes papers report conflicting BM25 baselines on BEIR. — [Vespa blog](https://blog.vespa.ai/improving-zero-shot-ranking-with-vespa-part-two/) [vendor]
- **sqlite-vec + FTS5 patterns.** The post gives three: (1) keyword-first `UNION ALL`, which does not de-duplicate; (2) RRF: CTEs for `fts_matches` (FTS5 rank, `row_number()`) and `vec_matches` (vec0 KNN), `full outer join … on vec_matches.article_id = fts_matches.rowid`, scored `coalesce(1.0/(:rrf_k + fts.rank_number),0)*:weight_fts + coalesce(1.0/(:rrf_k + vec.rank_number),0)*:weight_vec` with `rrf_k = 60` and both weights 1.0; (3) FTS5 results re-ordered by `vec_distance_cosine` against stored embeddings, which cannot surface semantic-only matches. No latency or quality numbers are given (14.5k headlines, 768-dim). Caveats: vectors cannot `highlight()` like FTS5, and phrase/NEAR/boolean FTS5 queries do not map to vectors. — [Alex Garcia: hybrid search with sqlite-vec](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- **Cost of both queries.** Elastic notes that RRF latency grows because the queries run one after the other, though BM25 is usually the faster one. — [Elastic hybrid blog](https://www.elastic.co/search-labs/blog/improving-information-retrieval-elastic-stack-hybrid)
- **Cross-encoder rerankers.** Sentence-Transformers MS MARCO table (hardware not stated):

  | Model          | TREC DL19 NDCG@10 | docs/sec |
  | -------------- | ----------------- | -------- |
  | TinyBERT-L2-v2 | 69.84             | 9000     |
  | MiniLM-L2-v2   | 71.01             | 4100     |
  | MiniLM-L4-v2   | 73.04             | 2500     |
  | MiniLM-L6-v2   | 74.30             | 1800     |
  | MiniLM-L12-v2  | 74.31             | 960      |

  — [SBERT pretrained cross-encoders](https://sbert.net/docs/cross_encoder/pretrained_models.html) (the docs/sec figures were very likely measured on a GPU; not stated)

- bge-reranker-v2-m3: one blog reports ~200–400 ms per query on CPU for only 3 documents. One HF user reports 3,000 candidates with MiniLM-L6 taking 6–7 s on unspecified hardware (~2 ms per pair). — [bswen reranker comparison](https://docs.bswen.com/blog/2026-02-25-best-reranker-models/) [indep]; [HF discussion](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2/discussions/5) [indep]

### Inferences

- In SQLite, run both legs in one statement (FTS5 top-N CTE plus vec0 KNN CTE, k = 50–100 each), fused by RRF with k=60. FTS5 BM25 over 25k–100k documents should cost a few ms to tens of ms, so the vector leg dominates total latency (see the sizing table).
- Map `fts.rowid` and the vec0 primary key to the _same_ chunk or document id. If vectors are per chunk and FTS5 is per document, aggregate chunk hits to a document (max, or best rank) before fusing.
- Reranking: at ~2 ms per pair on one CPU core (inferred from the HF report), MiniLM-L6 over the top 50 is ~100 ms, or roughly 50–200 ms on Graviton2 with ONNX/int8. That is feasible but takes a whole vCPU per query. bge-reranker-v2-m3 is ~17× MiniLM-L6's 22.7M params (568M per the search summary) and would plausibly take seconds for the top 50 on this CPU. Do not plan for it on a t4g.medium.

### Gaps

- No published primary BEIR table of BM25 vs dense vs RRF(BM25+dense) with a small 384-dim model was retrieved. The Elastic +18% used a learned sparse model.
- No measured cross-encoder latency on ARM CPU for top-50 was found.
- The k=60 recommendation was not confirmed from the Cormack PDF (it redirected and was not fetched).

## Is semantic search worth it vs BM25 + a synonym list for short keyword queries on a small corpus?

### Takeaway

The evidence says BM25 is a strong zero-shot baseline. Dense retrievers trained on MS MARCO often lose to it out of domain. Hybrid RRF almost never does worse than BM25 and usually does better. For Bindersnap (short queries, exact policy terms, regulatory citations, acronyms) BM25 + synonyms should come first, with dense retrieval added as a second RRF leg once it is measured. It should not replace BM25.

### Cited Findings

- BEIR (Thakur et al., 2021): "BM25 is a robust baseline"; re-ranking and late-interaction models "on average achieve the best zero-shot performances" at high computational cost; dense and sparse models "often underperform other approaches". — [BEIR, arXiv 2104.08663](https://arxiv.org/abs/2104.08663)
- Dense models trained on MS MARCO beat BM25 on MS MARCO "as they are trained specifically on this data set. However, they are usually worse out-of-domain." — [Elastic: benchmarking passage retrieval](https://www.elastic.co/es/search-labs/blog/improving-information-retrieval-elastic-stack-benchmarking-passage-retrieval) [vendor]
- RRF hybrid was "either better or similar to BM25 alone" on all 9 BEIR datasets tested. — [Elastic hybrid blog](https://www.elastic.co/search-labs/blog/improving-information-retrieval-elastic-stack-hybrid) [vendor]
- A 2026 practitioner write-up argues BM25 "still wins on the queries that matter" (exact identifiers, rare terms) in production hybrid systems. — [tianpan.co, Apr 2026](https://tianpan.co/blog/2026-04-12-hybrid-search-production-bm25-dense-embeddings) [indep, opinion; not fetched in full]

### Inferences

- Healthcare policy queries are often exact terms ("hand hygiene", "CMS 482.42", "HIPAA", "restraint", form numbers), which is where BM25 wins. Paraphrase queries ("what do we do when a patient falls") are where dense retrieval helps, and a synonym list covers part of that cheaply.
- A sensible staging: (1) FTS5 BM25 with a domain synonym and acronym list; (2) add a dense leg via RRF only if a small labelled query set, about 40 queries per Elastic's finding, shows a gain; (3) consider a reranker last.
- Documents of 2,000–4,000 words need chunking for dense retrieval. One vector per document dilutes meaning, and small embedding models have ~512-token limits. FTS5 handles whole documents natively.

### Gaps

- No domain-specific (healthcare policy) hybrid evaluation was found.
- No study isolating short (1–3 word) queries on small corpora, comparing BM25+synonyms with dense, was found in this pass.
