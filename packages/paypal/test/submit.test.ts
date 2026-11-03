// SPEC §6.5.1 / §6.5.2 — what a payout request must look like on the wire.
//
// The money facts are all here: one batch per intent, one item, both keys equal to the
// intent's idempotency key, and the amount as an exact two-decimal string built from integer
// cents. A retry can only be safe if these never drift.

import { describe, expect, it } from 'vitest';
import type { PayPalIntent } from '../src/index.js';
import { PRIYA, env, fixture, harness, json, withToken } from './helpers.js';

const CREATED = fixture<Record<string, unknown>>('payout-created-201');
const TOKEN = fixture<Record<string, any>>('token-response');
/** Ids come from the recording, so replacing a fixture never needs a test edit. */
const CREATED_BATCH_ID = (CREATED as any).batch_header.payout_batch_id as string;

function created(message: Record<string, unknown> = CREATED): Response {
  return json(message, 201);
}

describe('submit: the request', () => {
  it('sends one batch with one item, keyed by the intent idempotency key', async () => {
    const { rail, fetch } = harness(withToken(() => created()));

    const result = await rail.submit(PRIYA);

    const payouts = fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(payouts).toHaveLength(1);
    const call = payouts[0]!;
    expect(call.method).toBe('POST');
    expect(call.headers['paypal-request-id']).toBe(PRIYA.idempotencyKey);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['authorization']).toBe(`Bearer ${TOKEN.access_token}`);

    const body = JSON.parse(call.body ?? '{}') as Record<string, any>;
    expect(body.sender_batch_header.sender_batch_id).toBe(PRIYA.idempotencyKey);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      recipient_type: 'EMAIL',
      amount: { value: '1200.00', currency: 'USD' },
      receiver: PRIYA.receiver,
      note: PRIYA.memo,
      sender_item_id: PRIYA.intentId,
    });

    expect(result).toMatchObject({
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: CREATED_BATCH_ID,
      receiver: PRIYA.receiver,
      requestedReceiver: PRIYA.receiver,
    });
  });

  it('turns integer cents into exact two-decimal strings', async () => {
    const cases: Array<[number, string]> = [
      [5, '0.05'],
      [100, '1.00'],
      [64000, '640.00'],
      [73800, '738.00'],
      [135000, '1350.00'],
      [508800, '5088.00'],
      [100000000, '1000000.00'],
    ];
    const { rail, fetch } = harness(withToken(() => created()));

    for (const [cents] of cases) {
      await rail.submit({ ...PRIYA, amount: cents });
    }

    const sent = fetch.calls
      .filter((call) => call.url.endsWith('/v1/payments/payouts'))
      .map((call) => (JSON.parse(call.body ?? '{}') as any).items[0].amount.value);
    expect(sent).toEqual(cases.map(([, value]) => value));
  });

  it('refuses a fractional cent or a non-USD currency before it asks for a token', async () => {
    const fractional = harness(withToken(() => created()));
    await expect(fractional.rail.submit({ ...PRIYA, amount: 1200.5 })).rejects.toThrow(/whole number of cents/i);
    expect(fractional.fetch.calls).toHaveLength(0);

    const currency = harness(withToken(() => created()));
    const euros = { ...PRIYA, currency: 'EUR' } as unknown as PayPalIntent;
    await expect(currency.rail.submit(euros)).rejects.toThrow(/USD/);
    expect(currency.fetch.calls).toHaveLength(0);
  });

  it('refuses a key or sender_item_id PayPal would reject, before sending anything', async () => {
    const longKey = harness(withToken(() => created()));
    await expect(longKey.rail.submit({ ...PRIYA, idempotencyKey: 'k'.repeat(257) })).rejects.toThrow(/sender_batch_id/i);
    expect(longKey.fetch.calls).toHaveLength(0);

    const longItem = harness(withToken(() => created()));
    await expect(longItem.rail.submit({ ...PRIYA, intentId: 'i'.repeat(64) })).rejects.toThrow(/sender_item_id/i);
    expect(longItem.fetch.calls).toHaveLength(0);

    const emptyKey = harness(withToken(() => created()));
    await expect(emptyKey.rail.submit({ ...PRIYA, idempotencyKey: '   ' })).rejects.toThrow(/idempotency key/i);
    expect(emptyKey.fetch.calls).toHaveLength(0);
  });

  it('refuses a payout with no receiver instead of sending a payable-looking request', async () => {
    const { rail, fetch } = harness(withToken(() => created()));
    await expect(rail.submit({ ...PRIYA, receiver: '  ' })).rejects.toThrow(/no payee address/i);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('submit: receiver mapping (SPEC §6.5.5)', () => {
  const mapped = env({ PBP_RECEIVER_MAP: JSON.stringify({ ven_priya: 'priya.sandbox@example.com' }) });

  it('replaces the scenario email with the sandbox account when the vendor is known', async () => {
    const { rail, fetch } = harness(withToken(() => created()), { env: mapped });
    const intent: PayPalIntent = { ...PRIYA, vendorId: 'ven_priya' };

    const result = await rail.submit(intent);

    const body = JSON.parse(fetch.calls.at(-1)!.body ?? '{}') as any;
    expect(body.items[0].receiver).toBe('priya.sandbox@example.com');
    expect(result.receiver).toBe('priya.sandbox@example.com');
    expect(result.requestedReceiver).toBe(PRIYA.receiver);
  });

  it('also accepts a map keyed by the scenario email, case-insensitively', async () => {
    const byEmail = env({ PBP_RECEIVER_MAP: JSON.stringify({ 'Priya@NairWords.example': 'priya.sandbox@example.com' }) });
    const { rail, fetch } = harness(withToken(() => created()), { env: byEmail });

    await rail.submit(PRIYA);

    const body = JSON.parse(fetch.calls.at(-1)!.body ?? '{}') as any;
    expect(body.items[0].receiver).toBe('priya.sandbox@example.com');
  });

  it('leaves an unmapped receiver alone and records both addresses', async () => {
    const { rail, fetch } = harness(withToken(() => created()), { env: mapped });
    const intent: PayPalIntent = { ...PRIYA, vendorId: 'ven_sofia' };

    const result = await rail.submit(intent);

    const body = JSON.parse(fetch.calls.at(-1)!.body ?? '{}') as any;
    expect(body.items[0].receiver).toBe(PRIYA.receiver);
    expect(result).toMatchObject({ receiver: PRIYA.receiver, requestedReceiver: PRIYA.receiver });
  });
});
