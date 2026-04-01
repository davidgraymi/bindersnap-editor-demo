import { describe, expect, test } from 'bun:test';
import { verifyStripeSignature } from './webhook';

const SECRET = 'whsec_test_secret_key_for_tests';

/** Build a valid Stripe-style signature header for the given payload. */
async function buildSignature(rawBody: string, timestamp: string, secret: string): Promise<string> {
  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = Buffer.from(mac).toString('hex');
  return `t=${timestamp},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  test('accepts a valid signature', async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const timestamp = '1700000000';
    const sig = await buildSignature(body, timestamp, SECRET);
    expect(await verifyStripeSignature(body, sig, SECRET)).toBe(true);
  });

  test('rejects a tampered body', async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const timestamp = '1700000000';
    const sig = await buildSignature(body, timestamp, SECRET);
    const tampered = JSON.stringify({ type: 'charge.refunded' });
    expect(await verifyStripeSignature(tampered, sig, SECRET)).toBe(false);
  });

  test('rejects a wrong secret', async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const timestamp = '1700000000';
    const sig = await buildSignature(body, timestamp, SECRET);
    expect(await verifyStripeSignature(body, sig, 'wrong_secret')).toBe(false);
  });

  test('rejects a tampered signature hex', async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const timestamp = '1700000000';
    const sig = await buildSignature(body, timestamp, SECRET);
    const tampered = sig.replace(/v1=[0-9a-f]{4}/, 'v1=0000');
    expect(await verifyStripeSignature(body, tampered, SECRET)).toBe(false);
  });

  test('accepts when multiple v1 sigs are present and one matches', async () => {
    const body = '{"type":"test"}';
    const timestamp = '1700000001';
    const validSig = await buildSignature(body, timestamp, SECRET);
    const hex = validSig.split('v1=')[1];
    const multiSig = `t=${timestamp},v1=deadbeef,v1=${hex}`;
    expect(await verifyStripeSignature(body, multiSig, SECRET)).toBe(true);
  });

  test('returns false for missing timestamp', async () => {
    expect(await verifyStripeSignature('{}', 'v1=abc123', SECRET)).toBe(false);
  });

  test('returns false for missing v1 sig', async () => {
    expect(await verifyStripeSignature('{}', 't=1700000000', SECRET)).toBe(false);
  });

  test('returns false for empty signature string', async () => {
    expect(await verifyStripeSignature('{}', '', SECRET)).toBe(false);
  });

  test('returns false for completely malformed header', async () => {
    expect(await verifyStripeSignature('{}', 'not-a-stripe-header', SECRET)).toBe(false);
  });
});
