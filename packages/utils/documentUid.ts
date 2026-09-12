/**
 * A document's identity, which is not its name.
 *
 * [ADR 0005](../../docs/adr/0005-document-identity-and-version-tags.md) makes a
 * document a UID minted at creation and never changed, carried as a *segment*
 * of its filename — `nursing/hand-hygiene.01J8XZ4K7MQ9V3B0RN7YHS2E1D.md`. The
 * human half of that name says what the document is called; this says which
 * document it is.
 *
 * That separation is what lets a policy be retitled without restarting its
 * version numbering. Under ADR 0004 the version tag was `<slugPath>/vN`, so a
 * rename silently minted v1 of a policy on its fifth revision and orphaned four
 * tags that still pointed at real commits — and a version number is the one
 * thing this product cannot be casually wrong about.
 *
 * **A ULID, not a UUID**, and the ADR is specific about why: the identifier
 * appears in every filename and every tag name, and 36 characters of hyphenated
 * hex is a tax on both. A ULID is 26 characters, has no hyphens to confuse a
 * path segment, and sorts by creation time as a string.
 *
 * Implemented here rather than taken as a dependency. The format is 128 bits in
 * Crockford's base32 and fits in a page; a new package would have to be baked
 * into the app container's image before anything could import it, which is a
 * poor trade for this much code.
 */

/**
 * Crockford's base32: the digits, then the letters with `I`, `L`, `O` and `U`
 * removed. `I`/`1` and `O`/`0` are the pairs a person transcribes wrongly, and
 * `U` is dropped so the encoding cannot spell an obscenity by accident.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = 32;

/** 48 bits of milliseconds, base32-encoded. Good until the year 10889. */
const TIME_LEN = 10;
/** 80 bits of randomness. */
const RANDOM_LEN = 16;

export const DOCUMENT_UID_LENGTH = TIME_LEN + RANDOM_LEN;

/** What a minted UID looks like, for validating one that arrived from outside. */
const UID_PATTERN = new RegExp(`^[${ENCODING}]{${DOCUMENT_UID_LENGTH}}$`);

function encodeTime(now: number): string {
  let remaining = now;
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i -= 1) {
    const mod = remaining % ENCODING_LEN;
    out = ENCODING[mod] + out;
    remaining = (remaining - mod) / ENCODING_LEN;
  }
  return out;
}

/**
 * The random half, from bytes the caller supplies.
 *
 * One character per byte, taking the low 5 bits. Wasteful of the byte and
 * exact about the alphabet: 16 characters is 80 bits of entropy either way.
 */
function encodeRandomFrom(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += ENCODING[byte % ENCODING_LEN];
  return out;
}

function encodeRandom(): string {
  // Cryptographic randomness rather than Math.random. Two documents sharing a
  // UID share a version series, so a collision is not a cosmetic problem — and
  // Math.random makes no promise about independence between two processes that
  // start at the same moment, which is exactly how an API container scales.
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  return encodeRandomFrom(bytes);
}

/**
 * Mint a new document UID.
 *
 * Sortable by creation time to the millisecond. Two documents created inside
 * the same millisecond sort arbitrarily against each other — the ADR asks for
 * "short and sortable", not for a monotonic counter, and nothing in the product
 * orders documents by their identifier.
 */
export function mintDocumentUid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/**
 * A UID built from bytes the caller chose, rather than from randomness.
 *
 * For the **seed**, and for nothing else. Seeding runs again on every
 * `bun run up` and only rewrites what changed, so a document's identity has to
 * come out the same every time — a minted one would make every re-seed a new
 * document with a fresh version history, which is the opposite of what the seed
 * is for. Every other caller wants {@link mintDocumentUid}: a derived identity
 * is only as unique as whatever it was derived from.
 *
 * Takes at least {@link DOCUMENT_UID_LENGTH} minus the time component bytes;
 * anything beyond that is ignored.
 */
export function documentUidFrom(now: number, bytes: Uint8Array): string {
  if (bytes.length < RANDOM_LEN) {
    throw new Error(
      `A document uid needs ${RANDOM_LEN} bytes to build its random half, and got ${bytes.length}.`,
    );
  }
  return encodeTime(now) + encodeRandomFrom(bytes.subarray(0, RANDOM_LEN));
}

/**
 * Is this one of ours?
 *
 * Used wherever a UID arrives from outside — a filename in the tree, a tag
 * name — before it is treated as an identity. A tag whose first segment is not
 * one of these is a tag somebody else wrote, and is not a version of anything
 * this product published.
 */
export function isDocumentUid(value: string): boolean {
  return UID_PATTERN.test(value);
}

/** When a UID was minted, or null if it is not one of ours. */
export function documentUidMintedAt(uid: string): number | null {
  if (!isDocumentUid(uid)) return null;

  let time = 0;
  for (const char of uid.slice(0, TIME_LEN)) {
    time = time * ENCODING_LEN + ENCODING.indexOf(char);
  }
  return time;
}
