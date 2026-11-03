// SPEC §6.3.3 / §6.5.1 — cancel is only for UNCLAIMED, and a RETURNED receipt means
// "cancelled" only when our own cancel caused it. A payee who claimed first must come out as
// proven, never as cancelled.
//
// The real sandbox refused every cancel on 2026-10-29 (400 BATCH_NOT_COMPLETED, then 500
// INTERNAL_SERVICE_ERROR); those two recordings are replayed here so the rail can never turn a
// refusal into "cancelled". The RETURNED shape is still the official sample — see
// docs/research/paypal-sandbox-spike.md §(d).

import { describe, expect, it } from 'vitest';
import type { PayPalRailError } from '../src/index.js';
import { PRIYA, fixture, harness, json, withToken } from './helpers.js';

const UNCLAIMED = fixture<Record<string, any>>('payout-item-unclaimed');
const RETURNED = fixture<Record<string, any>>('payout-item-cancel-returned');
const SUCCESS = fixture<Record<string, any>>('payout-item-success');
const BATCH = fixture<Record<string, any>>('payout-batch-get');
const NOT_COMPLETED = fixture<Record<string, any>>('cancel-batch-not-completed-400');
const SANDBOX_500 = fixture<Record<string, any>>('cancel-internal-service-error-500');

const BASE = 'https://api-m.sandbox.paypal.com';
const UNCLAIMED_ITEM_ID = UNCLAIMED.payout_item_id as string;
const UNCLAIMED_BATCH_ID = UNCLAIMED.payout_batch_id as string;
const SUCCESS_ITEM_ID = SUCCESS.payout_item_id as string;
const BATCH_ID = BATCH.batch_header.payout_batch_id as string;
const BATCH_ITEM_ID = BATCH.items[0].payout_item_id as string;

const ITEM_URL = `${BASE}/v1/payments/payouts-item/${UNCLAIMED_ITEM_ID}`;
const CANCEL_URL = `${ITEM_URL}/cancel`;

const REF = {
  intentId: PRIYA.intentId,
  idempotencyKey: PRIYA.idempotencyKey,
  senderBatchId: PRIYA.idempotencyKey,
  payoutBatchId: UNCLAIMED_BATCH_ID,
  payoutItemId: UNCLAIMED_ITEM_ID,
};

/** The documented success sample, pinned to the recorded item so the "our own cancel" check can match. */
const RETURNED_ITEM = { ...RETURNED, payout_item_id: UNCLAIMED_ITEM_ID, payout_batch_id: UNCLAIMED_BATCH_ID };

describe('cancel', () => {
  it('cancels an UNCLAIMED item, then reads RETURNED as cancelled', async () => {
    let cancelled = false;
    const { rail, fetch } = harness(
      withToken((request) => {
        if (request.method === 'POST' && request.url === CANCEL_URL) {
          cancelled = true;
          return json(RETURNED_ITEM);
        }
        if (request.url === ITEM_URL) return json(cancelled ? RETURNED_ITEM : UNCLAIMED);
        return json({}, 404);
      }),
    );

    await rail.cancel(REF);
    const receipt = await rail.fetchReceipt(REF);

    const cancelCall = fetch.calls.find((call) => call.url === CANCEL_URL)!;
    expect(cancelCall.method).toBe('POST');
    expect(cancelCall.body).toBe('{}');
    // The status is read before we ask PayPal to cancel: only an unclaimed item can be cancelled.
    const order = fetch.calls.map((call) => `${call.method} ${call.url}`);
    expect(order.indexOf(`GET ${ITEM_URL}`)).toBeLessThan(order.indexOf(`POST ${CANCEL_URL}`));

    expect(receipt).toMatchObject({ railStatus: 'RETURNED', proof: 'cancelled', statusKnown: true });
  });

  it('refuses to cancel an item the payee already claimed, and keeps the receipt SUCCESS', async () => {
    const { rail, fetch } = harness(withToken(() => json(SUCCESS)));

    const error = (await rail.cancel({ ...REF, payoutItemId: SUCCESS_ITEM_ID }).catch((thrown: unknown) => thrown)) as PayPalRailError;

    expect(error).toMatchObject({ kind: 'not_cancelable' });
    expect(error.message).toMatch(/only an unclaimed payout can be cancelled/i);
    expect(fetch.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/cancel'))).toHaveLength(0);

    const receipt = await rail.fetchReceipt({ ...REF, payoutItemId: SUCCESS_ITEM_ID });
    expect(receipt).toMatchObject({ railStatus: 'SUCCESS', proof: 'proven' });
  });

  it('treats a payee who claims between the check and the cancel as proven, not cancelled', async () => {
    const { rail } = harness(
      withToken((request) => {
        if (request.method === 'POST' && request.url === CANCEL_URL) {
          return json(
            {
              name: 'ITEM_INCORRECT_STATUS',
              message: 'You can only cancel items that are unclaimed.',
              debug_id: '0000000000000',
              details: [{ field: 'payout_item_id', issue: 'ITEM_INCORRECT_STATUS' }],
              links: [],
            },
            400,
          );
        }
        // Every read now says the payee got the money before we could cancel.
        return json(SUCCESS);
      }),
    );

    await expect(rail.cancel(REF)).rejects.toMatchObject({ kind: 'not_cancelable' });

    const receipt = await rail.fetchReceipt(REF);
    expect(receipt).toMatchObject({ railStatus: 'SUCCESS', proof: 'proven' });
  });

  it('reports the recorded BATCH_NOT_COMPLETED 400 as a refusal, never as cancelled', async () => {
    const { rail } = harness(
      withToken((request) => {
        if (request.method === 'POST' && request.url === CANCEL_URL) return json(NOT_COMPLETED, 400);
        return json(UNCLAIMED);
      }),
    );

    const error = (await rail.cancel(REF).catch((thrown: unknown) => thrown)) as PayPalRailError;

    expect(error).toMatchObject({ kind: 'rejected', status: 400 });
    expect(error.message).toMatch(/would not cancel this payout/i);
    // The payment is unchanged: the receipt is still UNCLAIMED, so the caller must not say cancelled.
    const receipt = await rail.fetchReceipt(REF);
    expect(receipt).toMatchObject({ railStatus: 'UNCLAIMED', proof: 'pending' });
  });

  it('reports the recorded sandbox 500 on cancel as a refusal, never as cancelled', async () => {
    const { rail } = harness(
      withToken((request) => {
        if (request.method === 'POST' && request.url === CANCEL_URL) return json(SANDBOX_500, 500);
        return json(UNCLAIMED);
      }),
    );

    const error = (await rail.cancel(REF).catch((thrown: unknown) => thrown)) as PayPalRailError;

    expect(error).toMatchObject({ kind: 'rejected', status: 500 });
    expect(error.message).toMatch(/payment is unchanged/i);
    const receipt = await rail.fetchReceipt(REF);
    expect(receipt).toMatchObject({ railStatus: 'UNCLAIMED', proof: 'pending' });
  });

  it('finds the item from the batch id when the caller has not learned it yet', async () => {
    let cancelled = false;
    const batchUrl = `${BASE}/v1/payments/payouts/${BATCH_ID}`;
    const itemUrl = `${BASE}/v1/payments/payouts-item/${BATCH_ITEM_ID}`;
    const { rail, fetch } = harness(
      withToken((request) => {
        if (request.url === batchUrl) return json(BATCH);
        if (request.method === 'POST' && request.url === `${itemUrl}/cancel`) {
          cancelled = true;
          return json({ ...RETURNED, payout_item_id: BATCH_ITEM_ID, payout_batch_id: BATCH_ID });
        }
        return json(cancelled ? { ...RETURNED, payout_item_id: BATCH_ITEM_ID, payout_batch_id: BATCH_ID } : UNCLAIMED);
      }),
    );

    await rail.cancel({ ...REF, payoutBatchId: BATCH_ID, payoutItemId: null });

    expect(fetch.calls.some((call) => call.url === `${itemUrl}/cancel` && call.method === 'POST')).toBe(true);
  });
});
