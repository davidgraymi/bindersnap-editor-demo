import { describe, test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { LocalTokenCrypto } from "./token-crypto";

function freshCrypto(): LocalTokenCrypto {
  return new LocalTokenCrypto(randomBytes(32));
}

describe("LocalTokenCrypto", () => {
  test("round-trips a token", async () => {
    const crypto = freshCrypto();
    const { ciphertext, wrappedDek } = await crypto.encrypt("tok_abc123");
    const out = await crypto.decrypt(ciphertext, wrappedDek);
    expect(out).toBe("tok_abc123");
  });

  test("ciphertext does not contain the plaintext", async () => {
    const crypto = freshCrypto();
    const plaintext = "tok_super_secret_value_42";
    const { ciphertext, wrappedDek } = await crypto.encrypt(plaintext);
    expect(ciphertext.toString("utf8")).not.toContain(plaintext);
    expect(wrappedDek.toString("utf8")).not.toContain(plaintext);
  });

  test("each encrypt produces a different DEK and IV", async () => {
    const crypto = freshCrypto();
    const a = await crypto.encrypt("tok");
    const b = await crypto.encrypt("tok");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  test("ciphertext tampering is rejected by the GCM auth tag", async () => {
    const crypto = freshCrypto();
    const { ciphertext, wrappedDek } = await crypto.encrypt("tok_abc123");
    const lastIdx = ciphertext.length - 1;
    ciphertext[lastIdx] = (ciphertext[lastIdx] ?? 0) ^ 0xff;
    await expect(crypto.decrypt(ciphertext, wrappedDek)).rejects.toThrow();
  });

  test("wrappedDek tampering is rejected", async () => {
    const crypto = freshCrypto();
    const { ciphertext, wrappedDek } = await crypto.encrypt("tok_abc123");
    const lastIdx = wrappedDek.length - 1;
    wrappedDek[lastIdx] = (wrappedDek[lastIdx] ?? 0) ^ 0xff;
    await expect(crypto.decrypt(ciphertext, wrappedDek)).rejects.toThrow();
  });

  test("a different master key cannot decrypt", async () => {
    const a = freshCrypto();
    const b = freshCrypto();
    const { ciphertext, wrappedDek } = await a.encrypt("tok_abc123");
    await expect(b.decrypt(ciphertext, wrappedDek)).rejects.toThrow();
  });

  test("fromBase64 requires 32 decoded bytes", () => {
    expect(() => LocalTokenCrypto.fromBase64("dG9vc2hvcnQ=")).toThrow(
      /32 bytes/,
    );
    const valid = randomBytes(32).toString("base64");
    expect(() => LocalTokenCrypto.fromBase64(valid)).not.toThrow();
  });

  test("constructor rejects wrong-sized keys", () => {
    expect(() => new LocalTokenCrypto(randomBytes(16))).toThrow(/32 bytes/);
  });
});
