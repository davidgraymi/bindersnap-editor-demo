# Small text-embedding models and CPU runtimes for on-host semantic search (t4g.medium, ARM64, Bun)

Scope: English, CPU only, ARM64 Linux, 0.5–1 GiB RAM free for a model, Bun/TypeScript API. Corpus is the current version of each policy, 2,000–4,000 words each (~4,000 tokens), at 10k / 25k / 100k documents.

Labels used below: **[vendor]** = model author's own figure; **[indep]** = third-party measurement; **[derived]** = my calculation from cited inputs; **[memory]** = from prior knowledge, not re-verified this session.

## Candidate models: size, context, dimensions, quality, licence

### Takeaway

At the size that fits comfortably (≤50M parameters, ≤50 MB int8), bge-small-en-v1.5, snowflake-arctic-embed-s and granite-embedding-small-english-r2 are tied at the top for retrieval (~51–54 nDCG@10 on the MTEB/BEIR retrieval sets), all-MiniLM-L6-v2 is ~10 points lower, and static embeddings are ~15 points lower but 50–100x faster. EmbeddingGemma-300m is the quality step up (68.4 MTEB English v2 mean) but costs roughly 5x bge-small's compute per token and ships under the Gemma licence, not Apache/MIT.

### Comparison table

| Model                              | Params                                                  | Max seq (tokens)                     | Dims (Matryoshka)                           | Disk fp32 / fp16 / int8                                                                                                 | Retrieval quality                                                                                                                                                                                                                                                                            | Licence                                                                                     |
| ---------------------------------- | ------------------------------------------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| all-MiniLM-L6-v2                   | 22M                                                     | 256 word pieces (truncates) [memory] | 384 (no)                                    | ~90 / ~45 / ~23 MB [derived from params]                                                                                | MTEB Retrieval 41.95 ([arctic card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs)); 42.92 ([potion card](https://huggingface.co/minishlab/potion-retrieval-32M)); NanoBEIR 0.5623 ([HF blog](https://huggingface.co/blog/static-embeddings))                                   | Apache-2.0 [memory]                                                                         |
| bge-small-en-v1.5                  | 33M                                                     | 512 [memory]                         | 384 (no)                                    | **133 / 66.7 / 33.8 MB measured** ([Xenova ONNX files](https://huggingface.co/Xenova/bge-small-en-v1.5/tree/main/onnx)) | MTEB Retrieval 51.68 ([arctic card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs)); MTEB v2 Retrieval 53.9 ([granite card](https://huggingface.co/ibm-granite/granite-embedding-small-english-r2)); NanoBEIR 0.6267 ([HF blog](https://huggingface.co/blog/static-embeddings)) | MIT [memory]                                                                                |
| e5-small-v2                        | 33M                                                     | 512 [memory]                         | 384 (no)                                    | ~133 / ~67 / ~34 MB [derived, same arch as bge-small]                                                                   | MTEB Retrieval 49.04 ([arctic card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs)); MTEB v2 Retrieval 48.5 ([granite card](https://huggingface.co/ibm-granite/granite-embedding-small-english-r2))                                                                             | MIT [memory]                                                                                |
| gte-small                          | 33.4M                                                   | 512                                  | 384 (no)                                    | ~0.07 GB (fp16) ([card](https://huggingface.co/thenlper/gte-small))                                                     | MTEB avg 61.36, Retrieval 49.46 (15 sets) ([card](https://huggingface.co/thenlper/gte-small))                                                                                                                                                                                                | MIT ([card](https://huggingface.co/thenlper/gte-small))                                     |
| snowflake-arctic-embed-xs (v1)     | 22M                                                     | 512 (implied)                        | 384                                         | ~23 MB int8 [derived]                                                                                                   | MTEB Retrieval 50.15 [vendor] ([card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs))                                                                                                                                                                                           | Apache-2.0                                                                                  |
| snowflake-arctic-embed-s (v1)      | 33M                                                     | 512 (implied)                        | 384                                         | ~34 MB int8 [derived]                                                                                                   | MTEB Retrieval 51.98 [vendor] ([card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs))                                                                                                                                                                                           | Apache-2.0                                                                                  |
| arctic-embed v2.0                  | m (~305M) and l (568M) only found                       | 8192 [memory]                        | 768/1024, MRL 256 [memory]                  | too big for the budget at fp32                                                                                          | l-v2.0 BEIR 55.6 ([Docker card](https://hub.docker.com/r/aistaging/snowflake-arctic-embed-l-v2-vllm)); m-v2.0 55.38                                                                                                                                                                          | Apache-2.0 ([m-v2.0 card](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v2.0))  |
| granite-embedding-small-english-r2 | 47M                                                     | **8192**                             | 384                                         | ~190 / ~95 / ~47 MB [derived]                                                                                           | BEIR(15) 50.9, MTEB v2 avg 61.1, MTEB v2 Retrieval 53.9 [vendor] ([card](https://huggingface.co/ibm-granite/granite-embedding-small-english-r2))                                                                                                                                             | Apache-2.0                                                                                  |
| mxbai-embed-xsmall-v1              | 24.1M                                                   | 4096 (claimed)                       | 384 (MRL: −33% size keeps 96.2%)            | ~48 MB fp16 [derived]                                                                                                   | no BEIR/MTEB retrieval figure on card; ArguAna 49.58 only ([card](https://huggingface.co/mixedbread-ai/mxbai-embed-xsmall-v1))                                                                                                                                                               | Apache-2.0                                                                                  |
| nomic-embed-text-v1.5              | ~137M ("0.1B" on card)                                  | 8192                                 | 768 (MRL 512/256/128/64)                    | ~550 / ~275 / ~140 MB [derived]                                                                                         | MTEB avg 62.28 @768, 61.04 @256, 59.34 @128 ([card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5))                                                                                                                                                                                  | Apache-2.0; needs `search_query:` / `search_document:` prefixes                             |
| EmbeddingGemma-300m                | ~308M (most of it the token-embedding table [memory])   | 2048                                 | 768 (MRL 512/256/128)                       | fp32, q8, q4 ONNX exist; q8 ≈ 300 MB [derived]                                                                          | MTEB English v2 mean(task) 68.36 @768, 66.89 @256, 65.09 @128 ([ONNX card](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)); some sources report 69.67, conflicting ([search summary](https://huggingface.co/MichaelZag/embeddinggemma-300m))                                | **Gemma terms**, gated download ([card](https://huggingface.co/google/embeddinggemma-300m)) |
| potion-base-8M (model2vec, static) | ~8M                                                     | unbounded (bag of tokens)            | 256 [memory]                                | ~30 MB fp32 [derived]                                                                                                   | NanoBEIR 0.4421 ([HF blog](https://huggingface.co/blog/static-embeddings)) — below BM25's 0.4518 in the same table                                                                                                                                                                           | MIT [memory]                                                                                |
| potion-retrieval-32M (static)      | 32.3M                                                   | unbounded                            | MRL 32–512                                  | ~130 MB fp32 [derived]                                                                                                  | MTEB Retrieval 35.06 (vs MiniLM 42.92) [vendor] ([card](https://huggingface.co/minishlab/potion-retrieval-32M))                                                                                                                                                                              | MIT                                                                                         |
| static-retrieval-mrl-en-v1         | ~31M (30,522-token BERT-uncased vocab × 1024) [derived] | unbounded                            | 1024, MRL 32–1024; halving dims costs 1.47% | ~125 MB fp32 [derived]                                                                                                  | NanoBEIR 0.5032 (vs MiniLM 0.5623, bge-small 0.6267, BM25 0.4518) [vendor] ([HF blog](https://huggingface.co/blog/static-embeddings)); MTEB Retrieval 34.95 ([potion card](https://huggingface.co/minishlab/potion-retrieval-32M))                                                           | Apache-2.0                                                                                  |

### Cited Findings

- The quantised ONNX file for bge-small-en-v1.5 is 34 MB, against 133 MB at fp32 and 66.7 MB at fp16. There are also q4 (61.5 MB) and q4f16 (36.2 MB) exports, which are no smaller than int8 for a model this size — [Xenova/bge-small-en-v1.5 ONNX](https://huggingface.co/Xenova/bge-small-en-v1.5/tree/main/onnx)
- Snowflake's own table puts arctic-embed-s (51.98) slightly above bge-small (51.68) and e5-small-v2 (49.04), and arctic-embed-xs (50.15) far above all-MiniLM-L6-v2 (41.95) at the same 22M size — [snowflake-arctic-embed-xs card](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs)
- In IBM's table, granite-small-r2 (47M) ties bge-small on MTEB v2 Retrieval at 53.9, beats e5-small-v2 (48.5), and supports 8192 tokens — [granite card](https://huggingface.co/ibm-granite/granite-embedding-small-english-r2)
- A Hugging Face card warns that arctic-embed v2's BEIR scores may be inflated by training on in-domain BEIR data — [search result summary, arctic v2](https://hub.docker.com/r/aistaging/snowflake-arctic-embed-l-v2-vllm)
- EmbeddingGemma's activations do not support fp16. Use fp32, q8 or q4. It also needs task prompts: `task: search result | query: …` for queries, `title: … | text: …` for documents — [onnx-community/embeddinggemma-300m-ONNX](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)
- Static embeddings keep ~87% of all-mpnet-base-v2's NanoBEIR quality while running ~400x faster on CPU — [HF blog](https://huggingface.co/blog/static-embeddings)
- potion-retrieval-32M reaches 81.69% of all-MiniLM-L6-v2's MTEB Retrieval score — [card](https://huggingface.co/minishlab/potion-retrieval-32M)

### Inferences

- For policy text, which is long, formal and full of domain vocabulary, the gap between the static models (0.44–0.50 NanoBEIR) and BM25 (0.45) is small. A static model alone is unlikely to beat good lexical search. Its value is as a cheap semantic component in a hybrid with BM25 or FTS5.
- bge-small-en-v1.5, arctic-embed-s and gte-small are interchangeable in cost: the same BERT-small architecture, 12 layers, 384 hidden, ~34 MB int8. Choose on retrieval score and licence. arctic-embed-s (Apache-2.0) and bge-small (MIT) are the strongest.
- granite-small-r2 and mxbai-xsmall advertise long context. Chunking is still advisable, because full attention over 4,000 tokens costs about 8x more attention FLOPs per token than 512-token chunks, and one vector per 3,000-word policy blurs its sections together.
- EmbeddingGemma is the only candidate in the "clearly better" quality class that fits the RAM budget at q8, but its licence needs review before commercial use.

### Gaps

- No snowflake-arctic-embed xs or s **v2.0** was found. v2.0 appears to be only m and l, and v1.5 only m. Treat "xs/s v2" as not existing unless confirmed on the Snowflake Hugging Face organisation page.
- Retrieval scores come from different suites (MTEB v1 Retrieval with 15 sets, MTEB v2 Retrieval with 10, BEIR, NanoBEIR) and are not comparable across columns. No single independent table covering all candidates was found.
- mxbai-embed-xsmall-v1 has no published BEIR or MTEB retrieval average on its card.
- The licences for MiniLM, bge-small and e5-small-v2, and MiniLM's 256-token limit, are from memory. Verify them on the model cards.

## CPU throughput on ARM, int8 effects, static vs transformer

### Takeaway

No published benchmark measures these embedding models on Graviton2. Estimates have to come from FLOPs and adjacent ARM measurements. On two Neoverse N1 vCPUs, expect very roughly 1,500–3,800 tokens/s for MiniLM-L6, 750–1,900 for bge-small-class models, and 150–400 for EmbeddingGemma at int8, at full burst. Static embeddings run at hundreds of thousands of tokens per second and are limited by tokenisation, not by the model.

### Cited Findings

- On an i7-13700K, encoding short GooAQ queries [vendor], the measured sentences/sec were: static-retrieval-mrl-en-v1 107,420; potion-base-8M 124,030; all-MiniLM-L6-v2 1,739; all-MiniLM-L12-v2 910; bge-small-en-v1.5 888; bge-base 265. BM25 ran at 49,707 — [HF blog](https://huggingface.co/blog/static-embeddings)
- In the same measurements, bge-small is ~2x slower than MiniLM-L6 (12 layers vs 6), which matches its FLOPs — [HF blog](https://huggingface.co/blog/static-embeddings)
- A Raspberry Pi 5 (4× Cortex-A76 at 2.4 GHz, which has `asimddp`/dotprod and no i8mm) processed prompts with llama.cpp on Qwen2.5-0.5B Q4_0 at 93.5 tokens/s on 1 thread, 173.7 on 2 and 289.9 on 4 (pp512, KleidiAI off) [indep] — [llama.cpp discussion #30069](https://github.com/ggml-org/llama.cpp/discussions/30069)
- A Q4_0 nomic-embed-text run with llama.cpp on an Intel Xeon VM processed prompts at ~277 tokens/s, and about 2x slower when free memory was low [indep] — [llama.cpp #5846](https://github.com/ggml-org/llama.cpp/issues/5846)
- ONNX Runtime's fast ARM int8 (SMMLA/UMMLA) and bf16 (BFMMLA) GEMM kernels arrived in ORT 1.17 and target **Graviton3**. They gave up to 30% more int8 throughput and up to 65% for bf16 fast-math, against the older armv8 **DOT-product** kernels. Graviton2 (Neoverse N1: dotprod, no i8mm, no bf16, no SVE) gets only those DOT-based int8 kernels — [AWS ML blog](https://aws.amazon.com/blogs/machine-learning/accelerate-nlp-inference-with-onnx-runtime-on-aws-graviton-processors/)
- A community int8 QDQ MiniLM export reports roughly 1x the fp32 speed (cosine similarity 0.966), and int4 ~2x [vendor/community] — [search summary, nuvaidev MiniLM ONNX](https://huggingface.co/nuvaidev/all-MiniLM-L6-v2-onnx-quantized). An ARM64-specific `model_qint8_arm64.onnx` export also exists — [delwinn/all-MiniLM-L6-v2](https://huggingface.co/delwinn/all-MiniLM-L6-v2/tree/main/onnx)
- In-browser WASM, MiniLM takes ~8–12 ms per single-sentence embedding on an M2 MacBook Air (secondary source) — [SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)
- Training static embeddings is "400x faster", and inference is a lookup plus mean pooling — [HF blog](https://huggingface.co/blog/static-embeddings)

### Inferences (sizing model) [derived]

- **Cost per token.** A BERT encoder costs about 2 × non-embedding params FLOPs per token, plus attention of about 4·L·n·d. At chunk length n = 512 that gives about 26 MFLOP/token for MiniLM-L6 (6 layers, 384 hidden), about 52 MFLOP/token for bge-small, arctic-s, e5-small or gte-small (12×384), and about 240 MFLOP/token for EmbeddingGemma (~100M transformer params, 24 layers × 768 [memory]). The token-embedding lookup is free.
- **Compute available.** Two N1 cores at 2.5 GHz have a peak of 2 × 2.5 GHz × 16 FLOP/cycle = 80 GFLOPS fp32. ORT fp32 GEMM on small matrices typically reaches 30–50% of that, about 30 GFLOPS (the conservative case). The Pi 5 figure above implies ~50 GFLOP-equivalent per A76 core with well-tuned int8 dotprod kernels, about 100 GFLOP-eq on two N1 cores (the optimistic case).
- **Resulting throughput at full burst on 2 vCPUs:**
  - MiniLM-L6: ~1,150 tokens/s fp32; ~1,500–3,800 int8
  - bge-small class: ~580 fp32; ~750–1,900 int8
  - EmbeddingGemma: ~125 fp32; ~150–400 q8
  - static: ≥100k–500k tokens/s, limited by tokenisation
- **Cross-check.** MiniLM's 1,739 short sentences/s on a 16-core desktop is consistent with these per-core numbers.
- **Expected int8 speedup on Graviton2: about 1.5–2.5x over fp32,** below Graviton3's, because N1 lacks i8mm. The MiniLM QDQ report of "~1x" shows a badly placed quantisation can give nothing. Benchmark the specific export.
- **Batching.** Batching helps up to 8–32 sequences, then becomes memory-bound. The attention-score tensor for a batch of 32 × 12 heads × 512² fp32 is ~400 MB, so on this host batch 4–8 at 512 tokens (≈50–100 MB) is the safe ceiling.

### Gaps

- No independent tokens/s measurement of any candidate on Graviton2, Graviton3, Apple M-series or a Pi was found for ONNX Runtime or transformers.js. All transformer numbers above are derived estimates with roughly ±2x uncertainty. A 30-minute benchmark on a t4g (or a Pi 5 as a stand-in) should replace them before deciding.
- The int8-vs-fp32 speedup on Neoverse N1 for these exact models is unmeasured.

## Runtimes callable from Bun/Node, and their memory overhead

### Takeaway

transformers.js (`@huggingface/transformers`) on `onnxruntime-node` is the lowest-friction option in-process, and it ships Linux ARM64 CPU binaries. But Bun's N-API has a documented fatal-crash path with onnxruntime-node, so the embedding work should either run in a child process or sidecar that can crash safely, run under Node, or use the WASM backend, which is slower. A llama.cpp `llama-server` sidecar with GGUF models is the robust out-of-process alternative. Static embeddings need no runtime at all: a tokenizer plus a `Float32Array` lookup in TypeScript.

### Cited Findings

- onnxruntime-node publishes prebuilt CPU binaries for Linux arm64 — [npm onnxruntime-node](https://npmjs.com/package/onnxruntime-node)
- Under Bun, onnxruntime-node can crash the process with `NAPI FATAL ERROR: Error::New napi_create_error`. The crash is intermittent, comes after the process has run for some time, and is caused by an incomplete N-API path in Bun. The report is on macOS arm64. `@huggingface/transformers` 4.x imports onnxruntime-node statically. The workaround was to inject `onnxruntime-web` (WASM) under Bun and keep native ORT under Node — [cortexkit/magic-context PR #124](https://github.com/cortexkit/magic-context/pull/124)
- An earlier transformers.js PR (2024) said only onnxruntime 1.16.x worked under Bun — [transformers.js PR #489](https://github.com/huggingface/transformers.js/pull/489). A 2023 Bun issue reports onnxruntime-node failing under Bun — [oven-sh/bun #6143](https://github.com/oven-sh/bun/issues/6143)
- transformers.js uses onnxruntime-node in Node and onnxruntime-web in the browser — [transformers.js ONNX backend docs](https://huggingface.co/docs/transformers.js/api/backends/onnx)
- transformers.js v4 was released on 2026-02-09 with a C++ WebGPU runtime. Its blog says the same code runs in Node, Bun and Deno and claims a ~4x speedup for BERT embedding models, but it makes no CPU or ARM64-Linux claims — [HF blog, transformers.js v4](https://huggingface.co/blog/transformersjs-v4)
- transformers.js loads EmbeddingGemma ONNX with `dtype: "fp32" | "q8" | "q4"` — [onnx-community card](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX)
- onnxruntime-node postinstall can fail with a 404 when binaries are released out of order (seen on x64) — [onnxruntime #20727 mirror](https://git.tdem.in/microsoft/onnxruntime/issues/20727)
- A llama.cpp single embedding took 298–353 s on an 8-core cgroup because the thread pool did not respect container limits. Set `--threads` explicitly in Docker — [ThakiCloud](https://thakicloud.com/tech-blog/en/dev/llama-cpp-threads-batch-cgroup/)
- Ollama's nomic-embed-text card lists a 2,048 context against the model's native 8,192, so `num_ctx` has to be set — [morphllm summary](https://www.morphllm.com/ollama-embedding-models)

### Inferences

| Runtime                                             | Fit for Bun on t4g                          | Approx. memory overhead beyond weights                                          | Notes                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| transformers.js + onnxruntime-node, in-process      | Works, but carries the Bun N-API crash risk | ORT native library + arena ~50–150 MB [estimate]                                | Simplest. A crash takes down the API, so it belongs in a `Bun.spawn` worker process or a Node child                       |
| transformers.js + onnxruntime-web (WASM) under Bun  | Safe                                        | Small, but WASM is single-threaded unless SharedArrayBuffer threads are enabled | Probably 2–4x slower than native on ARM [estimate]                                                                        |
| onnxruntime-node directly (own tokenizer)           | Same crash risk                             | Same                                                                            | Avoids transformers.js, but tokenisation then has to come from `@huggingface/tokenizers` or the transformers.js tokenizer |
| llama.cpp `llama-server --embedding` sidecar (GGUF) | HTTP from Bun; process isolated             | ~20–50 MB plus weights [estimate]                                               | Supports BERT, nomic and EmbeddingGemma GGUFs [memory]; Q8_0 uses dotprod on N1; one more container for pyinfra to manage |
| Ollama                                              | HTTP; Go daemon on top of llama.cpp         | heavier (daemon + model swapping) [estimate]                                    | Convenient, but redundant next to llama-server                                                                            |
| Rust sidecar (ort or candle; fastembed-rs)          | HTTP or stdio; isolated                     | Smallest steady-state [estimate]                                                | Most build effort; fastembed-rs wraps ort [memory]                                                                        |
| fastembed (Python)                                  | Would add a Python service                  | Python + ORT ~150+ MB [estimate]                                                | No maintained JS port found; fastembed-js is believed archived [memory]                                                   |
| Static embeddings in TypeScript                     | Native, no addon                            | Just the matrix (30–130 MB fp32, half at fp16)                                  | A tokenizer plus mean-pooling over a `Float32Array`; no crash surface                                                     |

- Whatever the runtime, run the indexing job under `nice` or `cpulimit` in its own process, so it cannot starve Gitea or the API of the two vCPUs.

### Gaps

- No report was found of onnxruntime-node specifically under Bun on **Linux** ARM64. Whether the N-API crash reproduces with the current Bun (late 2026) is unverified.
- No measured RSS figures were found for ORT, llama-server or Ollama with these models. The overheads above are estimates.
- Whether transformers.js v4 still depends on onnxruntime-node for the CPU path in Node and Bun is not stated in the release blog.

## Burstable CPU: t4g.medium baseline, credits, unlimited cost

### Takeaway

A t4g.medium earns 24 credits an hour (a 20% per-vCPU baseline, i.e. 0.4 vCPU sustained), banks at most 576, and launches in Unlimited mode by default. A full re-embed of the corpus runs for hours to days at 100% of both vCPUs. In Standard mode the credit bank lasts about 6 hours and then throughput falls to 20%. In Unlimited mode the surplus is billed at a low flat rate (about $4–$55 for a 100k-document backfill), so the real cost is contention with Gitea and the API, not money. Embedding a single query costs a negligible fraction of a credit.

### Cited Findings

- t4g.medium: 24 CPU credits earned per hour, a maximum of 576 accrued, 2 vCPUs, 20% baseline per vCPU. One credit is one vCPU at 100% for one minute — [AWS EC2 burstable docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html)
- T4g supports Standard and Unlimited, defaults to **Unlimited**, earns no launch credits, and keeps accrued credits for 7 days after a stop — [AWS docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html)
- In Unlimited mode, if average CPU over 24 h exceeds the baseline, the surplus is billed at a flat per-vCPU-hour rate. In Standard mode the instance falls back to baseline once credits run out — [AWS docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html); [Unlimited concepts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html)
- The surplus rate commonly used for T4g is $0.04 per vCPU-hour (Linux). Only a user's re:Post calculation was found, not the AWS price table, so treat it as unverified — [re:Post](https://repost.aws/ko/questions/QU3_rVJhlLT-q1Uqm-YnODTw/burstable-instance-surplus-cpu-credits-charge); the rate is published under "T2/T3/T4g Unlimited Mode Pricing" on the [EC2 on-demand pricing page](https://aws.amazon.com/ec2/pricing/on-demand/#T2.2FT3.2FT4g_Unlimited_Mode_Pricing)

### Inferences [derived]

- **Burst at 100% on both vCPUs.** This spends 120 credits an hour against 24 earned, a net drain of 96 an hour, so a full 576 bank lasts about **6 hours**. After that, Standard mode caps the whole instance at 0.4 vCPU, roughly 1/5 of burst throughput, shared with Gitea and the API. That is unacceptable during a long backfill.
- **Unlimited surplus.** Each hour at 2 vCPUs is about 1.6 vCPU-hours above baseline, so 1.6 × hours × $0.04 is about **$0.064 per hour of full-speed embedding**.
- **Query embedding.** About 20–30 tokens through bge-small int8 is ~1.3 GFLOP, ~15–40 ms on one core. That is about 0.0005 credits, negligible next to the 24 earned per hour. EmbeddingGemma is about 5x that, ~60–200 ms. MiniLM is ~5–20 ms. Static embeddings take under 1 ms.
- **Re-embedding one document on publish.** About 4,600 tokens takes ~2.5–6 s with bge-small int8, ~0.1–0.2 credits. EmbeddingGemma takes ~12–30 s. Both are trivial at the rate policies change.

### Gaps

- The exact current T4g surplus rate was not confirmed from AWS's own price list.

## Indexing time at 10k / 25k / 100k documents

### Takeaway

At full two-vCPU burst, a bge-small-class int8 model embeds 10k policies in ~7–17 h, 25k in ~17–43 h and 100k in ~3–7 days. MiniLM is about half that, EmbeddingGemma about 5x longer (100k ≈ 2–5 weeks), and a static model does 100k in about 15–80 minutes. On the shared t4g.medium this rules out EmbeddingGemma for a 100k backfill, and makes even bge-small at 100k a multi-day background job best run off-host or on a temporarily larger instance, with incremental re-embedding on publish afterwards.

### Assumptions [derived]

- ~3,000 words is about 4,000 WordPiece tokens. Split into 512-token chunks with a 64-token overlap (stride 448), that is ~9 chunks and ~4,600 tokens per document. 256-token chunks give ~17 chunks and the same total tokens, at a slightly lower attention cost.
- The corpus is 46M tokens at 10k documents, 115M at 25k and 460M at 100k.
- Throughput is the range from the throughput section: conservative to optimistic, int8, 2 vCPUs at 100%.

| Model (int8, 2 vCPU burst)                           | tokens/s                      | 10k docs (46M tok) | 25k docs (115M tok) | 100k docs (460M tok)    | Unlimited surplus cost at 100k (@$0.04/vCPU-h) |
| ---------------------------------------------------- | ----------------------------- | ------------------ | ------------------- | ----------------------- | ---------------------------------------------- |
| static (potion / static-retrieval-mrl)               | 100k–500k                     | 1.5–8 min          | 4–19 min            | 15–77 min               | ≈ $0                                           |
| all-MiniLM-L6-v2 / arctic-embed-xs                   | 1,500–3,800                   | 3.4–8.5 h          | 8.4–21 h            | 34–85 h (1.4–3.5 days)  | ~$3.4–$8.7                                     |
| bge-small / arctic-embed-s / gte-small / e5-small-v2 | 750–1,900                     | 6.7–17 h           | 17–43 h             | 67–170 h (2.8–7.1 days) | ~$4.3–$11                                      |
| granite-small-r2 (47M)                               | ~550–1,400 (scaled by params) | 9–23 h             | 23–58 h             | 91–232 h                | ~$6–$15                                        |
| EmbeddingGemma-300m (q8)                             | 150–400                       | 32–85 h            | 80–213 h            | 319–852 h (13–36 days)  | ~$20–$55                                       |

- **At baseline only** (Standard mode after the bank is spent, or a deliberate cap at 20%), multiply every time by about 5. That still leaves nothing for Gitea or the API.
- **Batch size.** Batches of 4–8 chunks at 512 tokens keep activations to about 50–100 MB. With model weights of 23–300 MB plus ORT overhead, all candidates except EmbeddingGemma fp32 (~1.2 GB) fit in 0.5–1 GiB.
- **Vector storage**, adjacent to this question but material. 100k documents × 9 chunks × 384 dims is ~345M values: ~1.4 GB at fp32, ~345 MB at int8, ~230 MB with Matryoshka 256 at int8. Storing raw fp32 chunk vectors in RAM at 100k does not fit in the free budget. Quantised or truncated vectors, or an on-disk index, are needed.
- **Brute-force search** over 345M int8 values is ~50–150 ms on two cores per query. At 10k documents (~35M values) it is single-digit milliseconds.

### Gaps

- Every throughput figure is a FLOP-based estimate cross-checked against x86 and Raspberry Pi measurements, not measured on a t4g. A benchmark script (one model, int8, batch 8, 512 tokens, `--threads 2`, on a t4g or c6g.large) is needed to narrow the ±2x range.
- Tokenisation throughput in JS for the static models, the actual bottleneck there, was not measured.
