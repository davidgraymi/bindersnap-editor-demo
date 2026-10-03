/**
 * Gitea's answers that cannot change, kept.
 *
 * **Only reads addressed by a full object hash.** A tree at a commit, a blob,
 * a file's raw bytes at `?ref=<sha>`: the address *is* the content, so the
 * same request gets the same bytes for as long as the object exists. Nothing
 * here can be stale — the same reasoning that lets AGENTS.md allow a derived
 * index keyed on an immutable git coordinate. A branch name, a tag name or
 * `main` is never cached: those move.
 *
 * **Per credential.** The key is the address and whose token asked, so one
 * person is never served bytes another read. Access is still Gitea's to
 * decide on each first read; a repeat of a read already granted is what this
 * saves.
 *
 * Bounded by bytes and evicted oldest-first, in memory, in this process. It is
 * empty on every start and loses nothing but speed when dropped.
 */

/** A full SHA-1 or SHA-256 hex object name. Short hashes are ambiguous. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const CONTENT_PATH =
  /\/repos\/[^/]+\/[^/]+\/(?:git\/(?:trees|blobs)\/([^/?]+)|raw\/[^?]+)$/;

/** Whether a Gitea API address names its content by object hash. */
export function isContentAddressed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const match = parsed.pathname.match(CONTENT_PATH);
  if (!match) return false;
  if (match[1] !== undefined) {
    return OBJECT_NAME.test(decodeURIComponent(match[1]));
  }
  const ref = parsed.searchParams.get("ref");
  return ref !== null && OBJECT_NAME.test(ref);
}

interface Entry {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

export class ContentCache {
  readonly #maxBytes: number;
  readonly #maxEntryBytes: number;
  /** Insertion order is recency: a hit moves its entry to the end. */
  readonly #entries = new Map<string, Entry>();
  #bytes = 0;

  constructor(options: { maxBytes: number; maxEntryBytes?: number }) {
    this.#maxBytes = options.maxBytes;
    this.#maxEntryBytes = options.maxEntryBytes ?? options.maxBytes / 8;
  }

  get size(): number {
    return this.#entries.size;
  }

  get bytes(): number {
    return this.#bytes;
  }

  /** A fresh Response for the kept answer, or null. */
  get(key: string): Response | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return new Response(entry.body.slice(0), {
      status: entry.status,
      headers: entry.headers,
    });
  }

  /**
   * Keep a successful answer. Read from a clone, so the caller's own response
   * is untouched. Anything but a 200, and anything too large to be worth a
   * slot, is not kept.
   */
  async put(key: string, response: Response): Promise<void> {
    if (response.status !== 200) return;
    const body = await response.clone().arrayBuffer();
    if (body.byteLength > this.#maxEntryBytes) return;

    const previous = this.#entries.get(key);
    if (previous) {
      this.#bytes -= previous.body.byteLength;
      this.#entries.delete(key);
    }
    this.#entries.set(key, {
      status: response.status,
      headers: [...response.headers.entries()],
      body,
    });
    this.#bytes += body.byteLength;

    for (const [oldest, entry] of this.#entries) {
      if (this.#bytes <= this.#maxBytes) break;
      this.#entries.delete(oldest);
      this.#bytes -= entry.body.byteLength;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}

/** 64 MB: a few thousand policy files, on a host with gigabytes. */
export const giteaContentCache = new ContentCache({
  maxBytes: 64 * 1024 * 1024,
});
