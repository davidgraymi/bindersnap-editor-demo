# Chunking strategy, and moving embedding off a single small host

Research date: 2026-11-04. Prices were read from vendor pages on this date unless noted. Corpus assumption from the brief: about 4,000 tokens per document, at 10k / 25k / 100k documents.

## A1. Chunking granularity: retrieval quality, vector counts, storage

### Takeaway

No single granularity wins across published benchmarks. Medium chunks of roughly 200–512 tokens with little or no overlap are a solid, cheap default. Overlap buys little and multiplies vectors. Structure-aware units (page or section) are competitive and the most consistent, and they can beat fixed tokens on structured documents. Propositions and late chunking add a few points of quality at a large index-size or model-constraint cost. For 4,000-token policies, 512-token chunks give about 8–9 vectors per document. 256-token chunks give about 16–18. Paragraphs give tens.

### Cited Findings

- **Chroma technical report** (Smith & Troynikov, 3 Jul 2024; text-embedding-3-large, top-5 retrieval, about 472 synthetic queries over 5 corpora). Results by chunker, size and overlap:

  | Chunker                              | Size (tokens)           | Overlap | Recall | Precision | IoU |
  | ------------------------------------ | ----------------------- | ------- | ------ | --------- | --- |
  | Recursive                            | 200                     | 0       | 88.1   | 7.0       | 6.9 |
  | Recursive                            | 400                     | 0       | 89.5   | 3.6       | —   |
  | Recursive                            | 400                     | 200     | 88.1   | 3.3       | —   |
  | Recursive                            | 800                     | 400     | 85.4   | 1.5       | —   |
  | TokenText (the OpenAI-style default) | 800                     | 400     | 87.9   | 1.4       | 1.4 |
  | ClusterSemantic                      | 400 (about 182 average) | —       | 91.3   | 4.5       | —   |
  | ClusterSemantic                      | 200                     | —       | 87.3   | 8.0       | 8.0 |
  | LLM chunker (GPT-4o)                 | about 240 average       | —       | 91.9   | 3.9       | —   |
  | Kamradt semantic (default)           | about 660 average       | —       | 83.6   | 1.5       | —   |

  — [Chroma](https://www.trychroma.com/research/evaluating-chunking)

- The Chroma authors conclude that overlap generally lowers IoU, because it returns redundant tokens. They call the 800/400 default a poor recall-efficiency tradeoff. Strategy alone moves recall by up to about 9 points. Caveats: the queries are synthetic and the dataset is small. — [Chroma](https://www.trychroma.com/research/evaluating-chunking)
- With the small local model all-MiniLM-L6-v2, the best recall in the Chroma study was 82.4 (TokenText, 250 tokens, 125 overlap). That is about 7 points below text-embedding-3-large, so the choice of model matters as much as the choice of chunker. — [Chroma](https://www.trychroma.com/research/evaluating-chunking)
- **NVIDIA** ("Finding the Best Chunking Strategy…", Steve Han, dated 18 Jun 2025 on the page; secondary sources call it a 2024 study). The metric is end-to-end RAG answer accuracy. Results:
  - Page-level chunking had the best average, 0.648, with the lowest standard deviation, 0.107.
  - Token chunks (128 to 2,048 tokens, 15% overlap) averaged 0.603–0.645.
  - Page-level beat section-level on average when both used the same extractor. FinanceBench was the exception, where section-level was slightly better.
  - KG-RAG: page-level 0.520 against 0.421 for 128-token chunks.
  - RAGBattlePacket: 1,024 tokens scored 0.804 against 0.790 for page-level.
  - Recommendations: 256–512 tokens or page-level for factoid queries, page-level or 1,024 tokens for analytical queries, and 10–20% overlap, with 15% best on FinanceBench.

  — [NVIDIA](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/)

- **Dense X Retrieval** (Chen et al., arXiv 2312.06648). Indexing propositions instead of passages improves Recall@20 by +10.1 points for unsupervised dense retrievers. For supervised retrievers the gain is +2.2 in v1 and +2.7 in a later version, so the versions disagree. One summary reports about +12 Recall@5 on average for SimCSE. Under a fixed word budget, the biggest advantage comes at 100–200 words retrieved. — [arXiv 2312.06648](https://arxiv.org/pdf/2312.06648) (via search summary; the exact table values were not re-checked)
- **Late chunking** (Jina, arXiv 2409.04701, v3 dated 7 Jul 2025). The model embeds the whole text and splits it before mean pooling, so each chunk's vector carries context from the rest of the document. Measured in nDCG@10, averaged over 3 models and 4 BeIR datasets:
  - Fixed-size chunks: +1.8 points absolute (+3.46% relative)
  - Sentence chunks: +1.9 points (+3.63%)
  - Semantic chunks: +1.5 points (+2.70%)

  Example with jina-v3 and 256-token chunks: TREC-COVID rises from 73.0 to 77.2. The gains are largest for small chunks and longer documents. For large chunks on some reading-comprehension tasks, naive chunking won. Late chunking needs a long-context embedding model that returns token-level output, which rules out most hosted embedding APIs. — [arXiv 2409.04701v3](https://arxiv.org/html/2409.04701v3)

### Inferences

- **Vectors per document** at 4,000 tokens. A whole-document vector is 1×.

  | Chunking                                                             | Vectors per document | 100k documents |
  | -------------------------------------------------------------------- | -------------------- | -------------- |
  | Whole document                                                       | 1                    | 100k           |
  | Sections (if a policy has 8–15 headings)                             | about 8–15           | —              |
  | 512 tokens, no overlap                                               | about 8              | —              |
  | 512 tokens, 15% overlap                                              | about 9–10           | about 0.95M    |
  | 256 tokens, no overlap                                               | about 16             | —              |
  | 256 tokens, 15% overlap                                              | about 18–19          | about 1.9M     |
  | Paragraphs (about 60–100 words each, 2,000–4,000 words per document) | about 25–65          | —              |
  | Propositions (several per sentence)                                  | about 100–200        | —              |

- **Raw float32 storage** is dimensions × 4 bytes:

  | Dimensions | Bytes per vector | 1M vectors   |
  | ---------- | ---------------- | ------------ |
  | 1024       | 4 KB             | about 4.1 GB |
  | 768        | 3 KB             | about 3.1 GB |
  | 384        | 1.5 KB           | about 1.5 GB |

  So 100k documents at 512-token chunks with 1024 dimensions comes to about 3.9 GB in float32. That does not fit beside Gitea and the API in 4 GiB of RAM. It does fit as int8 (about 1 GB) or binary (about 120 MB), or with 256–512 dimensions. A 256-token or paragraph scheme at 100k documents needs quantisation or a disk-based index. This is arithmetic, not a sourced figure.

- **What fits policy documents.** Policies have explicit headings and short numbered procedures. They resemble NVIDIA's structured corpora, where page- or section-level chunking was the most consistent. A heading-aware scheme fits them well: split by section, and cap each section at about 512 tokens with sub-splits on paragraph boundaries. It also gives natural jump targets (heading anchors).
- **Overlap.** Little evidence supports more than 10–20% overlap. Chroma shows overlap lowering efficiency, and recall does not improve. Skipping overlap saves about 15–20% of vectors.

### Gaps

- No published benchmark found on policy or procedure documents specifically.
- The proposition count multiplier (props vs. passages on Wikipedia) was not re-verified in this session. Recollection is about 257M propositions against about 41M passages, roughly 6×, but treat it as unconfirmed.
- LlamaIndex, Pinecone and Weaviate chunking studies were not fetched, for lack of time. Their results are mostly blog-level and not peer-reviewed.

## A2. Rank big, locate small: two-stage "retrieve section, then find the passage"

### Takeaway

It is cheap and well supported to rank with section-sized vectors, or to use hybrid BM25 and dense search, and then find the exact passage inside the top few hits by lexical highlighting or sentence-level re-scoring. Within-document localisation touches only a few thousand tokens per hit. Late chunking is the research-backed way to get passage vectors that still "know" their document, but it needs a self-hosted long-context model.

### Cited Findings

- **Granularity matters most for what you return, not only for how you rank.** Chroma's IoU (the share of returned tokens that are relevant) is 7–8% for 200-token chunks and 1.4% for 800-token chunks. Big units find the right area, but most of the text they return is noise. — [Chroma](https://www.trychroma.com/research/evaluating-chunking)
- **Dense X:** the advantage of fine-grained units is greatest when the budget of words retrieved is small (100–200 words). That supports returning a sentence- or proposition-sized span to the user, even when ranking was done on bigger units. — [arXiv 2312.06648](https://arxiv.org/pdf/2312.06648)
- **Anthropic's best pipeline is itself two-stage.** It retrieves the top 150 chunks with embeddings plus BM25, then reranks to the top 20. — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)
- **Late chunking** pools token embeddings from one full-document pass into chunk vectors. In one forward pass per document you get both a document-aware vector for ranking and per-chunk vectors for finding the passage. — [arXiv 2409.04701v3](https://arxiv.org/html/2409.04701v3)

### Inferences

- **A design suited to "jump to the exact passage"** has two stages:
  - **Stage 1.** Index sections, capped at about 512 tokens with a title and heading-path prefix, at about 8–15 vectors per document. Run hybrid search: SQLite FTS5 BM25 plus a vector kNN, merged with reciprocal-rank fusion.
  - **Stage 2.** For the top roughly 5–10 sections, split them into sentences or paragraphs and re-score each one.
  - **Two ways to re-score:**
    - (a) Lexical: BM25 or FTS5 `highlight()`/`snippet()` with the query terms. It costs nothing.
    - (b) Embedding: embed the sentences of the top sections at query time, about 5 sections × 512 tokens ≈ 2.5k tokens per query. At $0.02 per 1M tokens that is about $0.00005 per query. A local small model takes milliseconds to low seconds on CPU for that many tokens; this latency is not benchmarked here.
    - (c) Precompute and store paragraph vectors only for finding the passage, not for ranking. This trades storage (about 25–65 vectors per document) for latency.
- Option (a) alone often lands on the right paragraph for keyword-like queries ("hand hygiene", "sharps disposal"). Option (b) matters for paraphrase queries. A per-document-only index (1 vector per document) is viable for ranking only if the model accepts 4k+ tokens. Titan v2, OpenAI v3 and Cohere v4 do; BGE-en v1.5 at 512 tokens does not.
- Store character offsets, or the editor node or heading IDs, for each chunk and sentence, so the UI can scroll to and highlight the span.

### Gaps

- No published head-to-head found of "section retrieve + sentence locate" against "paragraph index" for passage localisation accuracy.
- Per-model context limits are from general knowledge and were not re-fetched this session: BGE-en v1.5 512 tokens; Titan v2 8,192; OpenAI text-embedding-3 8,191; Cohere v3 512; Cohere v4 128k.

## A3. Contextual chunk headers (Anthropic contextual retrieval)

### Takeaway

Adding 50–100 tokens of LLM-written context to each chunk cut top-20 retrieval failures by 35%. With contextual BM25 the cut was 49%, and with reranking 67%. Generating that context cost about $1.02 per 1M document tokens (Sept 2024 prices). A free deterministic variant, prepending the document title and heading path, captures part of the same idea at only the token overhead.

### Cited Findings

- Failure rate is 1 − recall@20, starting from a 5.7% baseline:

  | Method                  | Failure rate | Reduction |
  | ----------------------- | ------------ | --------- |
  | Baseline                | 5.7%         | —         |
  | Contextual embeddings   | 3.7%         | −35%      |
  | + Contextual BM25       | 2.9%         | −49%      |
  | + Rerank (top 150 → 20) | 1.9%         | −67%      |

  — [Anthropic, 19 Sep 2024](https://www.anthropic.com/news/contextual-retrieval)

- Cost: $1.02 per 1M document tokens, one time. That assumes 800-token chunks, 8k-token documents, a 50-token instruction, 100 tokens of context per chunk, and prompt caching. The context is typically 50–100 tokens per chunk. — [Anthropic](https://www.anthropic.com/news/contextual-retrieval)

### Inferences

- **LLM context at $1.02 per 1M tokens** (re-price against current model rates; the 2024 price may have changed):

  | Corpus                       | One-time cost | Monthly, with 5% of documents changing |
  | ---------------------------- | ------------- | -------------------------------------- |
  | 10k documents (40M tokens)   | about $41     | about $2                               |
  | 25k documents (100M tokens)  | about $102    | about $5                               |
  | 100k documents (400M tokens) | about $408    | about $20                              |

  It would also add a new LLM subprocessor unless the model is run through Bedrock (see B3).

- **Deterministic headers.** "Document title › Section › Subsection", about 10–30 tokens on a 512-token chunk, adds about 2–6% to embedding tokens, so costs are essentially unchanged. Policies have meaningful titles and headings, so this captures much of the "which document is this chunk from" signal. The gain is not measured in the Anthropic post; that is a gap.
- BM25 over the same chunks with their headers is free with SQLite FTS5, and is the second-largest gain in Anthropic's table.

### Gaps

- No published number found for title and heading-path prefixes alone, as opposed to LLM-generated context.

## A4. Words-to-tokens ratio

### Takeaway

English prose runs about 1.3 tokens per word with BPE (OpenAI's tokenizers) and similar or slightly more with WordPiece. That puts a 2,000–4,000-word policy at roughly 2,700–5,500 tokens. The brief's 4,000-token assumption is mid-range.

### Cited Findings

- OpenAI's rule of thumb is that 1 token ≈ 4 characters ≈ ¾ of a word, so 100 tokens ≈ 75 words, which is about 1.33 tokens per word. — [OpenAI Help: What are tokens](https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them) (well-known guidance; not re-fetched this session)

### Inferences

- BERT WordPiece, used by the BGE models, has a 30k vocabulary against about 100k for cl100k and o200k. It usually splits domain terms (for example "antimicrobial", "sterilization") into more pieces, so expect about 1.3–1.5 tokens per word. Healthcare jargon pushes toward the high end.
- Upper bound: 4,000 words × 1.4 ≈ 5,600 tokens. For the cost tables below, 4,000 tokens per document is used as instructed. Scale by about 1.4× for worst-case 4,000-word documents.

### Gaps

- No primary source fetched for WordPiece tokens per word on English text.

## B1. Off-host options and prices (per 1M input tokens, read 2026-11-04 unless noted)

### Takeaway

Hosted embedding is extremely cheap at these volumes, at $0.012–$0.20 per 1M tokens. The cheapest options already inside existing subprocessors are:

- Bedrock Titan Text Embeddings v2 at $0.02 (AWS)
- Workers AI bge-m3 or qwen3-embedding-0.6b at $0.012 (Cloudflare)

### Cited Findings

| Provider and model                                    | Price per 1M tokens | Notes                                                                                  | Source                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bedrock, Amazon Titan Text Embeddings V2              | $0.02               | Down from $0.10 for v1. A CloudPrice listing of $0.20 is likely a data error.          | [AWS launch blog](https://aws.amazon.com/blogs/machine-learning/get-started-with-amazon-titan-text-embeddings-v2-a-new-state-of-the-art-embeddings-model-on-amazon-bedrock/); [re:Post](https://repost.aws/questions/QURUISKOH2Q7-Usijt0BF44g/confirmation-of-amazon-bedrock-pricing-for-titan-embeddings-model) |
| Bedrock, Cohere Embed English / Multilingual v3       | $0.10               | Provisioned throughput $7.12 per model unit per hour, no commitment.                   | [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)                                                                                                                                                                                                                                                   |
| Bedrock, Cohere Embed v4                              | about $0.12         | Aggregators and the AWS Marketplace listing; one outlier at $0.06.                     | [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-j3fgisven2yrs); [Maxim](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/bedrock/model/cohere.embed-v4-0)                                                                                                                           |
| OpenAI text-embedding-3-small                         | $0.02               | No batch price listed on the page.                                                     | [OpenAI pricing](https://developers.openai.com/api/docs/pricing)                                                                                                                                                                                                                                                 |
| OpenAI text-embedding-3-large                         | $0.13               |                                                                                        | [OpenAI pricing](https://developers.openai.com/api/docs/pricing)                                                                                                                                                                                                                                                 |
| OpenAI ada-002                                        | $0.10               |                                                                                        | [OpenAI pricing](https://developers.openai.com/api/docs/pricing)                                                                                                                                                                                                                                                 |
| Voyage voyage-4-large                                 | $0.12               | Current models: 200M free tokens per account; Batch API 33% off with a 12-hour window. | [Voyage pricing](https://docs.voyageai.com/docs/pricing)                                                                                                                                                                                                                                                         |
| Voyage voyage-4                                       | $0.06               | as above                                                                               | [Voyage pricing](https://docs.voyageai.com/docs/pricing)                                                                                                                                                                                                                                                         |
| Voyage voyage-4-lite                                  | $0.02               | as above                                                                               | [Voyage pricing](https://docs.voyageai.com/docs/pricing)                                                                                                                                                                                                                                                         |
| Voyage voyage-context-3 (contextual chunk embeddings) | $0.18               | No free tokens.                                                                        | [Voyage pricing](https://docs.voyageai.com/docs/pricing)                                                                                                                                                                                                                                                         |
| Voyage rerankers                                      | $0.02–$0.05         |                                                                                        | [Voyage pricing](https://docs.voyageai.com/docs/pricing)                                                                                                                                                                                                                                                         |
| Workers AI bge-small-en-v1.5                          | $0.020              | 1,841 neurons per 1M tokens                                                            | [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                             |
| Workers AI bge-base-en-v1.5                           | $0.067              | 6,058 neurons per 1M tokens                                                            | [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                             |
| Workers AI bge-large-en-v1.5                          | $0.204              | 18,582 neurons per 1M tokens                                                           | [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                             |
| Workers AI bge-m3                                     | $0.012              | 1,075 neurons per 1M tokens                                                            | [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                             |
| Workers AI qwen3-embedding-0.6b                       | $0.012              |                                                                                        | [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                             |
| Workers AI plamo-embedding-1b                         | $0.019              |                                                                                        | [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                             |

- Workers AI billing: 10,000 neurons per day free, then $0.011 per 1,000 neurons on Workers Paid. — [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

### Inferences

- The 10k-neuron daily free tier covers about 9.3M bge-m3 tokens per day, or about 1.65M bge-base tokens per day. At 100k queries per month (about 3.3k per day × about 20 tokens), query embedding alone is about 67k tokens per day, well inside the free tier.

### Gaps

- Bedrock batch-inference prices for embeddings, and an official AWS-page figure for Cohere Embed v4, were not retrievable: the pricing page text was truncated.
- Cohere direct, Jina and Google (Gemini embedding or Vertex) prices were not fetched this session.

## B2. Cost to embed the corpus and keep it current

### Takeaway

At every scale, API embedding costs dollars, not hundreds of dollars:

- One-time full embedding: $0.48–$82
- Monthly upkeep (5% churn plus queries): under $5

A dedicated embedding instance costs $25–$58 a month, every month. It is 5–100× more expensive than calling an API at these scales, unless it runs only for backfills, for example as a spot instance that is stopped afterwards.

### Cited Findings

- Prices: see B1.
- On-demand rates in us-east-1, Linux (third-party trackers DoiT and Holori, snapshots Jan–Apr 2026; confirm on the AWS page):

  | Instance   | Spec           | Hourly                                                                       | Monthly at 730 hours |
  | ---------- | -------------- | ---------------------------------------------------------------------------- | -------------------- |
  | c7g.medium | 1 vCPU / 2 GiB | about $0.0363                                                                | about $26.50         |
  | c7g.large  | 2 vCPU / 4 GiB | $0.0725                                                                      | about $52.90         |
  | c8g.large  | 2 vCPU / 4 GiB | about $0.0798                                                                | about $58            |
  | t4g.large  | 2 vCPU / 8 GiB | about $0.0672 (inferred from reserved and xlarge rates, not directly listed) | about $49            |

  t4g.medium (the current host size) is about $0.0336 an hour, or about $24.50 a month (from general knowledge; not re-fetched). — [DoiT c7g.large](https://www.doit.com/compute/spot/us-east-1/c7g.large); [DoiT c7g.medium](https://www.doit.com/compute/spot/us-east-1/c7g.medium); [Holori c8g.large](https://calculator.holori.com/aws/ec2/c8g.large); [Holori t4g.large](https://calculator.holori.com/aws/ec2/t4g.large/us-east-1)

### Inferences (arithmetic; raw tokens = documents × 4,000)

- Corpus tokens are 40M, 100M and 400M. With about 15% overlap plus heading prefixes, multiply by about 1.2: 48M, 120M and 480M.

**One-time full embed (raw tokens; ×1.2 for chunked with overlap and headers):**

| Model                                                 | Price per 1M | 10k (40M)      | 25k (100M) | 100k (400M)     |
| ----------------------------------------------------- | ------------ | -------------- | ---------- | --------------- |
| Workers AI bge-m3 / qwen3-0.6b                        | $0.012       | $0.48          | $1.20      | $4.80           |
| Titan v2 / OpenAI 3-small / voyage-4-lite / bge-small | $0.02        | $0.80          | $2.00      | $8.00           |
| voyage-4                                              | $0.06        | $0 (free 200M) | $0 (free)  | $12 (200M paid) |
| Workers AI bge-base                                   | $0.067       | $2.68          | $6.70      | $26.80          |
| Cohere v3 (Bedrock)                                   | $0.10        | $4.00          | $10.00     | $40.00          |
| Cohere v4 (Bedrock)                                   | $0.12        | $4.80          | $12.00     | $48.00          |
| OpenAI 3-large                                        | $0.13        | $5.20          | $13.00     | $52.00          |
| Workers AI bge-large                                  | $0.204       | $8.16          | $20.40     | $81.60          |

**Monthly upkeep:**

- **Churn.** 5% of documents changing means 2M, 5M or 20M tokens a month if whole documents are re-embedded. That falls by about 5–10× if only changed sections are re-embedded, keyed by content hash.
- **Queries.** 10k–100k queries × about 20 tokens is 0.2M–2M tokens a month.
- **Worst case total.** About 22M tokens a month at 100k documents comes to:
  - $0.26 at $0.012
  - $0.44 at $0.02
  - $2.86 at $0.13
  - $4.49 at $0.204
- **Stage-2 sentence re-scoring** (A2 option b) adds about 2.5k tokens per query. 100k queries × 2.5k is 250M tokens a month: $5 at $0.02, $3 at $0.012. That makes it the largest recurring line, so prefer lexical highlighting, or precomputed paragraph vectors.

**Instance against API:**

- A c7g.medium running all the time is about $318 a year, against under $60 a year in API spend even at 100k documents with 3-small or Titan v2.
- An instance only wins if (a) data must not leave the host for legal reasons, (b) the model choice requires it (late chunking, or a custom or long-context open model), or (c) it is used as a short-lived backfill box (spot, hours not months).
- Separately, the cost on the current t4g.medium is memory and CPU contention with Gitea and the API, not dollars.

### Gaps

- Graviton CPU throughput (tokens per second) for bge-small, bge-base or bge-m3 under ONNX was not found in this session. It is needed to say how long a self-hosted backfill of 400M tokens would take.
- Spot prices for c7g and c8g were not captured.

## B3. Legal, subprocessor and data-use implications

### Takeaway

- **Bedrock** keeps the data with AWS, already Bindersnap's main subprocessor and the US host. AWS commits not to train on the data, not to share it with model providers (Cohere never sees it), and to keep it in-Region. It needs only an update to the AWS row ("what they do"), not a new subprocessor.
- **Workers AI** is also an existing subprocessor, but it would change Cloudflare's documented role from "in transit only" to processing Customer Content at the nearest edge location, which is not guaranteed US-only. It would also strain ADR 0006.
- **OpenAI, Voyage, Cohere direct and Jina** are each a new subprocessor. That triggers Bindersnap's own 30-day advance email notice and a right to object.

### Cited Findings

- **Bindersnap's DPA:** "We will give at least 30 days' notice before adding or replacing a Subprocessor that will process Customer Personal Data. We will update the subprocessors page and email the organization's owners." Customers may object within 30 days, and may cancel the affected Service with a pro-rated refund if the objection is unresolved. — `apps/legal/documents/dpa.md` (lines 55–57, repo)
- **Bindersnap's subprocessors page:** "We keep the list short and use each company only for what's listed here."
  - AWS row: "Hosts our servers, storage and backups (EC2, EBS, S3); keeps server logs (CloudWatch); delivers our email (SES)". Location "USA (us-east-1…; backup copies in us-west-2)".
  - Cloudflare row: Customer Content only "in transit between your browser and our servers", plus encrypted backups "which Cloudflare cannot read". Request location is "the Cloudflare data center nearest the visitor".

  — `apps/legal/documents/subprocessors.md` (version 2026-10-27, repo)

- **Bedrock:**
  - "your content is not used to improve the base models"; AWS and third-party providers "will not use any inputs to or outputs from Amazon Bedrock to train" models
  - "Users' inputs and model outputs are not shared with any model providers"
  - Content is stored at rest in the Region where you use Bedrock

  — [AWS Bedrock FAQs](https://aws.amazon.com/bedrock/faqs/)

- **Bedrock Model Deployment Accounts** are owned by the Bedrock service team. "Model providers don't have any access to those accounts … they don't have access to Amazon Bedrock logs or to customer prompts and completions." — [AWS Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html)
- **Cloudflare Workers AI:**
  - "Cloudflare does not use Customer Content processed by Workers AI to train AI models"
  - Cloudflare "does not retain inputs or outputs after they are no longer needed" for the request, unless you enable AI Gateway logging or caching
  - Operational metadata (timestamps, token counts) is kept and excludes content
  - Routing through AI Gateway to a third-party provider puts the content under that provider's terms

  — [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

- **OpenAI API:**
  - "data sent to the OpenAI API is not used to train or improve OpenAI models" unless you opt in
  - Abuse-monitoring logs are "retained for up to 30 days" by default
  - `/v1/embeddings` is eligible for Zero Data Retention and stores no application state
  - US data residency (storage and processing) via a US project or `us.api.openai.com`; eligibility requires contacting sales

  — [OpenAI: Your data](https://developers.openai.com/api/docs/guides/your-data)

### Inferences

- **Bedrock is the lowest-friction option, legally.** It is the same legal entity (Amazon Web Services, Inc.) and the same region (us-east-1), and Cohere is not a recipient. Bindersnap's DPA notice clause triggers on "adding or replacing a Subprocessor", which this is not. But the page's promise "use each company only for what's listed here" means the AWS row should add "converts document text into search vectors (Bedrock)" before launch. Courtesy notice to owners is prudent but arguably not contractually required. A lawyer or the `legal-reviewer` agent should confirm.
- **Workers AI is the same entity but a materially different role.** Today Cloudflare sees Customer Content only in transit, and backups it cannot read. Embedding would have Cloudflare process plaintext document text at "the data center nearest the visitor". For a server-side call from us-east-1 that is likely a US data center, but nothing found here guarantees it. The page's description and location would both have to change. Also, ADR 0006 restricts Workers that Bindersnap runs to ones that keep no customer content and are off the critical path. Calling Workers AI's REST API from the BFF isn't a Bindersnap Worker, but it sends evidence text to the edge, which conflicts with the spirit of that ADR. Expect an ADR amendment.
- **OpenAI, Voyage, Cohere direct, Jina and Google are each a new subprocessor**, with a 30-day email notice, an objection window, and a cancellation-with-refund remedy. Even with OpenAI's no-training default, the 30-day abuse retention would appear in the subprocessor description unless ZDR is approved. OpenAI's US residency requires a sales contact. Voyage's 200M free tokens would cover a full 25k-document embed, but the legal overhead outweighs a $2–$12 saving.
- **Healthcare-specific points:**
  - Bindersnap holds no PHI, so no BAA is needed for embedding.
  - Policies can occasionally contain incidental identifiers (an example patient name, a staff phone number), and embeddings are derived from that text. Picking a provider that commits to no training and no retention (Bedrock; Workers AI; OpenAI with ZDR) limits exposure.
  - Bedrock is generally listed as HIPAA-eligible under the AWS BAA, but Bindersnap should not lean on that or claim "HIPAA compliant". Not verified this session.
  - Embedding vectors should be treated as Customer Content. They are derived from the text and partially invertible, so they belong in the same data-deletion and export scope.
- **US-only customers.** Bedrock with a us-east-1 endpoint keeps processing in-Region. Avoid Bedrock "global" or cross-region inference profiles: model IDs with a `global.` prefix may route outside the US. The `us.` profile routes within US regions, which would still add regions beyond us-east-1 to the location column. Inferred from profile naming; verify against the Bedrock cross-region inference docs.

### Gaps

- Whether Workers AI inference for a US-originated server request is guaranteed to run in US data centres: no source found. Cloudflare's Data Localization Suite coverage of Workers AI was not checked.
- Bedrock's HIPAA eligibility and cross-region inference routing were not fetched this session.
- Voyage AI (MongoDB-owned, per general knowledge), Cohere direct and Jina data-retention terms were not fetched.
- Whether repurposing an existing subprocessor counts as "adding" one under common DPA interpretations is a legal question, not answered here.
