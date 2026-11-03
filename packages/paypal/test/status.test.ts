// SPEC §6.5.3 / AC-3 — the status table and the receipt. The batch status is never the proof:
// a SUCCESS batch can hold UNCLAIMED items, and only an item SUCCESS with a transaction id is
// "paid". Anything outside the table is pending, flagged as unknown for the caller to log.

import { describe, expect, it } from 'vitest';
import { isKnownRailStatus, mapStatus, type PayPalRailError } from '../src/index.js';
import { PRIYA, TEST_CLOCK, fixture, harness, json, withToken } from './helpers.js';

const SUCCESS = fixture<Record<string, any>>('payout-item-success');
const UNCLAIMED = fixture<Record<string, any>>('payout-item-unclaimed');
const BATCH = fixture<Record<string, any>>('payout-batch-get');

/** Ids, the transaction id and the receiver all come from the recordings. */
const BASE = 'https://api-m.sandbox.paypal.com';
const SUCCESS_ITEM_ID = SUCCESS.payout_item_id as string;
const SUCCESS_BATCH_ID = SUCCESS.payout_batch_id as string;
const SUCCESS_TX_ID = SUCCESS.transaction_id as string;
const SUCCESS_RECEIVER = SUCCESS.payout_item.receiver as string;
const UNCLAIMED_ITEM_ID = UNCLAIMED.payout_item_id as string;
const BATCH_ID = BATCH.batch_header.payout_batch_id as string;
const BATCH_ITEM_ID = BATCH.items[0].payout_item_id as string;
const ITEM_URL = `${BASE}/v1/payments/payouts-item/${SUCCESS_ITEM_ID}`;
const BATCH_URL = `${BASE}/v1/payments/payouts/${BATCH_ID}`;

describe('mapStatus: the whole SPEC §6.5.3 table', () => {
  it('maps each documented item status', () => {
    const table: Array<[string, string]> = [
      ['SUCCESS', 'proven'],
      ['PENDING', 'pending'],
      ['UNCLAIMED', 'pending'],
      ['ONHOLD', 'pending'],
      ['FAILED', 'failed'],
      ['BLOCKED', 'failed'],
      ['REFUNDED', 'failed'],
      ['REVERSED', 'failed'],
      ['RETURNED', 'failed'],
    ];
    for (const [railStatus, proof] of table) {
      expect(mapStatus(railStatus)).toBe(proof);
    }
  });

  it('ignores case and surrounding whitespace, as PayPal controls the casing', () => {
    expect(mapStatus(' success ')).toBe('proven');
    expect(mapStatus('Unclaimed')).toBe('pending');
  });

  it('treats a value outside the table as pending and says it is unknown', () => {
    expect(mapStatus('SOMETHING_NEW')).toBe('pending');
    expect(isKnownRailStatus('SOMETHING_NEW')).toBe(false);
    expect(isKnownRailStatus('SUCCESS')).toBe(true);
    expect(isKnownRailStatus('')).toBe(false);
  });
});

describe('fetchReceipt: item GET', () => {
  it('proves a SUCCESS item with a transaction id', async () => {
    const { rail, fetch } = harness(withToken(() => json(SUCCESS)));

    const receipt = await rail.fetchReceipt({
      intentId: PRIYA.intentId,
      idempotencyKey: PRIYA.idempotencyKey,
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: SUCCESS_BATCH_ID,
      payoutItemId: SUCCESS_ITEM_ID,
    });

    expect(receipt).toEqual({
      railStatus: 'SUCCESS',
      proof: 'proven',
      payoutItemId: SUCCESS_ITEM_ID,
      transactionId: SUCCESS_TX_ID,
      fetchedAt: new Date(TEST_CLOCK).toISOString(),
      source: 'rail_get',
      statusKnown: true,
      receiver: SUCCESS_RECEIVER,
    });
    expect(fetch.calls.map((call) => call.method)).toEqual(['POST', 'GET']); // token, then one GET
    expect(fetch.calls[1]!.url).toBe(ITEM_URL);
  });

  it('does not prove SUCCESS when PayPal returns no transaction id', async () => {
    const body = structuredClone(SUCCESS);
    delete body.transaction_id;
    const { rail } = harness(withToken(() => json(body)));

    const receipt = await rail.fetchReceipt({
      intentId: PRIYA.intentId,
      idempotencyKey: PRIYA.idempotencyKey,
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: null,
      payoutItemId: SUCCESS_ITEM_ID,
    });

    expect(receipt).toMatchObject({ railStatus: 'SUCCESS', proof: 'pending', transactionId: null });
  });

  it('keeps UNCLAIMED pending even though PayPal attached a transaction id', async () => {
    const { rail } = harness(withToken(() => json(UNCLAIMED)));

    const receipt = await rail.fetchReceipt({
      intentId: PRIYA.intentId,
      idempotencyKey: PRIYA.idempotencyKey,
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: null,
      payoutItemId: UNCLAIMED_ITEM_ID,
    });

    expect(receipt).toMatchObject({ railStatus: 'UNCLAIMED', proof: 'pending' });
  });

  it('reads the item out of a batch when only the batch id is known', async () => {
    const { rail, fetch } = harness(withToken(() => json(BATCH)));

    const receipt = await rail.fetchReceipt({
      intentId: PRIYA.intentId,
      idempotencyKey: PRIYA.idempotencyKey,
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: BATCH_ID,
      payoutItemId: null,
    });

    expect(fetch.calls[1]!.url).toBe(BATCH_URL);
    // batch_status is SUCCESS; the first item is UNCLAIMED. The receipt follows the item.
    expect(receipt).toMatchObject({ railStatus: 'UNCLAIMED', proof: 'pending', payoutItemId: BATCH_ITEM_ID });
  });

  it('lets a batch item without transaction_id stay pending rather than throwing', async () => {
    const body = structuredClone(BATCH);
    delete body.items[0].transaction_id; // the same recorded UNCLAIMED item, with the id removed
    const { rail } = harness(withToken(() => json(body)));

    const receipt = await rail.fetchReceipt({
      intentId: PRIYA.intentId,
      idempotencyKey: PRIYA.idempotencyKey,
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: BATCH_ID,
      payoutItemId: null,
    });

    expect(receipt).toMatchObject({ railStatus: 'UNCLAIMED', proof: 'pending', transactionId: null });
  });

  it('flags an unknown status and keeps it pending', async () => {
    const body = structuredClone(SUCCESS);
    body.transaction_status = 'IN_REVIEW';
    const { rail } = harness(withToken(() => json(body)));

    const receipt = await rail.fetchReceipt({
      intentId: PRIYA.intentId,
      idempotencyKey: PRIYA.idempotencyKey,
      senderBatchId: PRIYA.idempotencyKey,
      payoutBatchId: null,
      payoutItemId: SUCCESS_ITEM_ID,
    });

    expect(receipt).toMatchObject({ railStatus: 'IN_REVIEW', proof: 'pending', statusKnown: false });
  });

  it('refuses to invent a receipt when there is neither an item nor a batch id', async () => {
    const { rail, fetch } = harness(withToken(() => json(SUCCESS)));

    const error = (await rail
      .fetchReceipt({
        intentId: PRIYA.intentId,
        idempotencyKey: PRIYA.idempotencyKey,
        senderBatchId: PRIYA.idempotencyKey,
        payoutBatchId: null,
        payoutItemId: null,
      })
      .catch((thrown: unknown) => thrown)) as PayPalRailError;

    expect(error).toMatchObject({ kind: 'no_reference' });
    expect(error.message).toMatch(/nothing to ask about/i);
    expect(fetch.calls).toHaveLength(0);
  });

  it('reports a 404 as a human sentence, not as "paid"', async () => {
    const { rail } = harness(withToken(() => json({ name: 'RESOURCE_NOT_FOUND', message: 'not found' }, 404)));

    await expect(
      rail.fetchReceipt({
        intentId: PRIYA.intentId,
        idempotencyKey: PRIYA.idempotencyKey,
        senderBatchId: PRIYA.idempotencyKey,
        payoutBatchId: null,
        payoutItemId: 'MISSING',
      }),
    ).rejects.toThrow(/could not find that payout/i);
  });
});
