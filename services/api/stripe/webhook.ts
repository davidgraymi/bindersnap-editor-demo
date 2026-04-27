/**
 * Verifies a Stripe webhook signature using HMAC-SHA256 (Web Crypto API).
 * No Stripe SDK — uses native crypto.subtle.
 *
 * Stripe sends: stripe-signature: t=<timestamp>,v1=<hex_sig>[,v1=<other_sig>]
 * Signed payload: `${timestamp}.${rawBody}`
 */
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  try {
    const parts = sigHeader.split(",");

    let timestamp: string | null = null;
    const v1Sigs: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith("t=")) {
        timestamp = trimmed.slice(2);
      } else if (trimmed.startsWith("v1=")) {
        v1Sigs.push(trimmed.slice(3));
      }
    }

    if (!timestamp || v1Sigs.length === 0) {
      return false;
    }

    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > toleranceSeconds) {
      return false;
    }

    const signedPayload = `${timestamp}.${rawBody}`;
    const encoder = new TextEncoder();

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

    const computedBytes = new Uint8Array(signatureBuffer);
    const computedHex = Array.from(computedBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    for (const sig of v1Sigs) {
      if (sig.length !== computedHex.length) {
        continue;
      }

      const sigBytes = new Uint8Array(sig.length / 2);
      for (let i = 0; i < sig.length; i += 2) {
        sigBytes[i / 2] = Number.parseInt(sig.slice(i, i + 2), 16);
      }

      let equal = true;
      for (let i = 0; i < computedBytes.length; i++) {
        if (computedBytes[i] !== sigBytes[i]) {
          equal = false;
        }
      }

      if (equal) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
