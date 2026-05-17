import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

// Envelope-encryption primitive for `gitea_token` at rest in Postgres.
//
// Encrypt path:
//   1. Generate a random 32-byte DEK (data-encryption key) per session.
//   2. AES-256-GCM encrypt the token with the DEK → `ciphertext` blob.
//   3. Wrap the DEK by AES-256-GCM encrypting it with a master key → `wrappedDek`.
//   4. Persist `ciphertext` and `wrappedDek` side by side; the master key never
//      lands in the database, and the DEK never lands unwrapped.
//
// Decrypt path runs in reverse. A pg_dump of the sessions table therefore
// reveals neither plaintext tokens nor unwrapped DEKs.
//
// The current LocalTokenCrypto holds the master key in process memory, loaded
// from BINDERSNAP_TOKEN_ENCRYPTION_KEY (base64-encoded 32 bytes). Issue #224
// will swap this for an AWS-KMS-backed adapter in the Lambda cutover slice:
// KMS.GenerateDataKey replaces our random DEK + manual wrap step, and
// KMS.Decrypt replaces the manual unwrap. The interface and on-disk blob
// shapes stay identical so the swap doesn't require a data migration.

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard 96-bit nonce
const TAG_BYTES = 16; // GCM auth tag

export interface EncryptedToken {
  ciphertext: Buffer;
  wrappedDek: Buffer;
}

export interface TokenCrypto {
  encrypt(plaintext: string): Promise<EncryptedToken>;
  decrypt(ciphertext: Buffer, wrappedDek: Buffer): Promise<string>;
}

// Frame: iv (12 bytes) || tag (16 bytes) || ciphertext (n bytes).
// Same wire format is used for both the DEK wrap and the token ciphertext so
// they can be unwrapped with the same primitive.
function sealWithKey(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function openWithKey(key: Buffer, framed: Buffer): Buffer {
  if (framed.length < IV_BYTES + TAG_BYTES) {
    throw new Error("encrypted blob is too short to be a valid AES-GCM frame");
  }
  const iv = framed.subarray(0, IV_BYTES);
  const tag = framed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = framed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// Master-key-in-memory implementation. Suitable for local dev, integration
// tests, and a stop-gap production deployment where the master key is loaded
// from Secrets Manager into the Lambda environment. The KMS adapter (future)
// will share this class's public interface but call KMS.GenerateDataKey /
// KMS.Decrypt instead of doing the wrap step locally.
export class LocalTokenCrypto implements TokenCrypto {
  constructor(private readonly masterKey: Buffer) {
    if (masterKey.length !== KEY_BYTES) {
      throw new Error(
        `LocalTokenCrypto master key must be ${KEY_BYTES} bytes; got ${masterKey.length}`,
      );
    }
  }

  static fromBase64(masterKeyBase64: string): LocalTokenCrypto {
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `BINDERSNAP_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`,
      );
    }
    return new LocalTokenCrypto(key);
  }

  async encrypt(plaintext: string): Promise<EncryptedToken> {
    const dek = randomBytes(KEY_BYTES);
    const ciphertext = sealWithKey(dek, Buffer.from(plaintext, "utf8"));
    const wrappedDek = sealWithKey(this.masterKey, dek);
    return { ciphertext, wrappedDek };
  }

  async decrypt(ciphertext: Buffer, wrappedDek: Buffer): Promise<string> {
    const dek = openWithKey(this.masterKey, wrappedDek);
    try {
      const plaintext = openWithKey(dek, ciphertext);
      return plaintext.toString("utf8");
    } finally {
      dek.fill(0);
    }
  }
}

// Identity adapter used by the SQLite session backend, which still stores the
// token as plaintext in a local file. Keeps the type signature of
// PostgresSessionBackend uniform without forcing SQLite to pay for a wrap.
export class NoopTokenCrypto implements TokenCrypto {
  async encrypt(plaintext: string): Promise<EncryptedToken> {
    return {
      ciphertext: Buffer.from(plaintext, "utf8"),
      wrappedDek: Buffer.alloc(0),
    };
  }

  async decrypt(ciphertext: Buffer): Promise<string> {
    return ciphertext.toString("utf8");
  }
}
