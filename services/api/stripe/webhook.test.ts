import { describe, it, expect } from "bun:test";
import { verifyStripeSignature } from "./webhook";

const RAW_BODY = '{"test":"body"}';
const SECRET = "whsec_test_secret";

async function makeSignature(
  body: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload),
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe("verifyStripeSignature", () => {
  it("valid signature returns true", async () => {
    const ts = nowSeconds();
    const sig = await makeSignature(RAW_BODY, SECRET, ts);
    const header = `t=${ts},v1=${sig}`;
    expect(await verifyStripeSignature(RAW_BODY, header, SECRET)).toBe(true);
  });

  it("tampered body returns false", async () => {
    const ts = nowSeconds();
    const sig = await makeSignature(RAW_BODY, SECRET, ts);
    const header = `t=${ts},v1=${sig}`;
    expect(
      await verifyStripeSignature('{"test":"tampered"}', header, SECRET),
    ).toBe(false);
  });

  it("tampered signature returns false", async () => {
    const ts = nowSeconds();
    const sig = await makeSignature(RAW_BODY, SECRET, ts);
    const tamperedSig = sig.slice(0, -4) + "0000";
    const header = `t=${ts},v1=${tamperedSig}`;
    expect(await verifyStripeSignature(RAW_BODY, header, SECRET)).toBe(false);
  });

  it("wrong secret returns false", async () => {
    const ts = nowSeconds();
    const sig = await makeSignature(RAW_BODY, SECRET, ts);
    const header = `t=${ts},v1=${sig}`;
    expect(
      await verifyStripeSignature(RAW_BODY, header, "whsec_wrong_secret"),
    ).toBe(false);
  });

  it("expired timestamp returns false", async () => {
    const ts = nowSeconds() - 400;
    const sig = await makeSignature(RAW_BODY, SECRET, ts);
    const header = `t=${ts},v1=${sig}`;
    expect(await verifyStripeSignature(RAW_BODY, header, SECRET)).toBe(false);
  });

  it("multiple v1 sigs with one valid returns true", async () => {
    const ts = nowSeconds();
    const validSig = await makeSignature(RAW_BODY, SECRET, ts);
    const invalidSig = "a".repeat(validSig.length);
    const header = `t=${ts},v1=${invalidSig},v1=${validSig}`;
    expect(await verifyStripeSignature(RAW_BODY, header, SECRET)).toBe(true);
  });

  it("malformed sigHeader with no t= returns false", async () => {
    const ts = nowSeconds();
    const sig = await makeSignature(RAW_BODY, SECRET, ts);
    const header = `v1=${sig}`;
    expect(await verifyStripeSignature(RAW_BODY, header, SECRET)).toBe(false);
  });

  it("missing v1= returns false", async () => {
    const ts = nowSeconds();
    const header = `t=${ts}`;
    expect(await verifyStripeSignature(RAW_BODY, header, SECRET)).toBe(false);
  });
});
