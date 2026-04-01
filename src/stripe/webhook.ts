/**
 * Stripe webhook signature verification.
 * Stripe sends: stripe-signature: t=<timestamp>,v1=<sig>[,v1=<sig2>...]
 * We compute HMAC-SHA256(secret, "<timestamp>.<rawBody>") and compare.
 */
export async function verifyStripeSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(
      signature.split(",").map((part) => {
        const eq = part.indexOf("=");
        return [part.slice(0, eq), part.slice(eq + 1)];
      }),
    );

    const timestamp = parts["t"];
    const expectedSigs = signature.split(",")
      .filter((p) => p.startsWith("v1="))
      .map((p) => p.slice(3));

    if (!timestamp || expectedSigs.length === 0) return false;

    const payload = `${timestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const computed = Buffer.from(mac).toString("hex");

    return expectedSigs.some((sig) => sig === computed);
  } catch {
    return false;
  }
}
