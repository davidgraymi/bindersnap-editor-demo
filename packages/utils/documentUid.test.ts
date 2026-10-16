import { expect, test } from "bun:test";

import {
  DOCUMENT_UID_LENGTH,
  documentUidFrom,
  documentUidMintedAt,
  isDocumentUid,
  mintDocumentUid,
} from "./documentUid";

test("a minted uid is 26 Crockford base32 characters", () => {
  const uid = mintDocumentUid();
  expect(uid).toHaveLength(DOCUMENT_UID_LENGTH);
  expect(uid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(isDocumentUid(uid)).toBe(true);
});

test("the alphabet omits the characters people transcribe wrongly", () => {
  // I/1 and O/0 are the confusable pairs; U is dropped so the encoding cannot
  // spell an obscenity by accident.
  const uids = Array.from({ length: 200 }, () => mintDocumentUid()).join("");
  expect(uids).not.toMatch(/[ILOU]/);
});

test("uids sort by the time they were minted", () => {
  const earlier = mintDocumentUid(Date.parse("2026-01-01T00:00:00Z"));
  const later = mintDocumentUid(Date.parse("2026-09-09T00:00:00Z"));

  // String comparison, which is the point — a sort in SQL or in a listing
  // orders by creation without a second column.
  expect(earlier < later).toBe(true);
});

test("the mint time is readable back out", () => {
  const now = Date.parse("2026-09-09T12:34:56.789Z");
  expect(documentUidMintedAt(mintDocumentUid(now))).toBe(now);
});

test("two uids minted in the same millisecond still differ", () => {
  const now = Date.now();
  const uids = new Set(Array.from({ length: 500 }, () => mintDocumentUid(now)));
  // Same time component, 80 bits of randomness apart.
  expect(uids.size).toBe(500);
});

test("anything that is not one of ours is refused", () => {
  for (const notOurs of [
    "",
    "nursing/infection-control",
    "01J8XZ4K7MQ9V3B0RN7YHS2E1", // 25 — one short
    "01J8XZ4K7MQ9V3B0RN7YHS2E1DD", // 27 — one long
    "01J8XZ4K7MQ9V3B0RN7YHS2E1I", // contains I
    "01j8xz4k7mq9v3b0rn7yhs2e1d", // lower case
    "550e8400-e29b-41d4-a716-446655440000", // a UUID
  ]) {
    expect(isDocumentUid(notOurs)).toBe(false);
    expect(documentUidMintedAt(notOurs)).toBeNull();
  }
});

test("the random half really is the random half", () => {
  // Two minted at one instant share their time component and must differ
  // everywhere after it — a UID that were a counter would collide across two
  // API containers that started together.
  const now = Date.now();
  const a = mintDocumentUid(now);
  const b = mintDocumentUid(now);

  expect(a.slice(0, 10)).toBe(b.slice(0, 10));
  expect(a.slice(10)).not.toBe(b.slice(10));
});

test("a derived uid is the same every time, and a valid one", () => {
  // What the seed depends on: `bun run up` runs it again on every start and
  // only rewrites what changed, so an identity that moved would make every
  // re-seed a fresh document with no history.
  const bytes = new Uint8Array(16).fill(7);
  const now = Date.parse("2026-01-05T09:00:00Z");

  const uid = documentUidFrom(now, bytes);
  expect(documentUidFrom(now, bytes)).toBe(uid);
  expect(isDocumentUid(uid)).toBe(true);
  expect(documentUidMintedAt(uid)).toBe(now);
});

test("a derived uid refuses to be built from too few bytes", () => {
  // Silently padding would give two documents built from short inputs the same
  // identity, which is the one thing a uid may never do.
  expect(() => documentUidFrom(Date.now(), new Uint8Array(8))).toThrow(
    /16 bytes/,
  );
});
