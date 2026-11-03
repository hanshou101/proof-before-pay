// SPEC §6.5.2 — the part that makes a retry safe: never change the key, and treat PayPal's
// duplicate rejection as proof that the payment already left, not as a failure.
//
// Every scenario here is a recorded/fixture response. No socket is opened.

import { describe, expect, it } from 'vitest';
import { PayPalRailError, type PayPalIntent } from '../src/index.js';
import { PRIYA, env, fixture, harness, json, withToken } from './helpers.js';

const CREATED = fixture<Record<string, unknown>>('payout-created-201');
const DUPLICATE = fixture<Record<string, unknown>>('duplicate-sender-batch-id-400');
const SERVER_ERROR = fixture<Record<string, unknown>>('error-500');

/** The recording's own ids: the duplicate points at the batch the 201 created. */
const ORIGINAL_BATCH_URL = (DUPLICATE as any).details[0].link[0].href as string;
const ORIGINAL_BATCH_ID = ORIGINAL_BATCH_URL.split('/').pop()!;
const CREATED_BATCH_ID = (CREATED as any).batch_header.payout_batch_id as string;

function created(batchId = CREATED_BATCH_ID): Response {
  const body = structuredClone(CREATED) as any;
  body.batch_header.payout_batch_id = batchId;
  return json(body, 201);
}

function batch(batchId: string, status = 'UNCLAIMED'): Response {
  return json({
    total_items: 1,
    total_pages: 1,
    batch_header: { payout_batch_id: batchId, batch_status: 'SUCCESS', sender_batch_header: { sender_batch_id: 'x' } },
    items: [
      {
        payout_item_id: 'ITEM-1',
        transaction_status: status,
        payout_batch_id: batchId,
        payout_item: { recipient_type: 'EMAIL', amount: { value: '1.00', currency: 'USD' }, receiver: 'r@example.com' },
      },
    ],
  });
}

/** The same fake PayPal twice: the second attempt on a key must never create a second batch. */
function paypalWorld() {
  const batches = new Map<string, string>();
  let counter = 0;
  return {
    create(senderBatchId: string): string {
      const existing = batches.get(senderBatchId);
      if (existing !== undefined) throw new Error(`test world: ${senderBatchId} was already created`);
      const id = `BATCH${++counter}`;
      batches.set(senderBatchId, id);
      return id;
    },
    batches,
  };
}

describe('submit: idempotent replay and duplicate detection', () => {
  it('takes the batch id from a 201 replay', async () => {
    const { rail, fetch } = harness(withToken(() => created('SAME-BATCH')));

    await rail.submit(PRIYA);
    const replay = await rail.submit(PRIYA);

    expect(replay.payoutBatchId).toBe('SAME-BATCH');
    const posts = fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers['paypal-request-id']).toBe(posts[1]!.headers['paypal-request-id']);
    expect(JSON.parse(posts[1]!.body ?? '{}').sender_batch_header.sender_batch_id).toBe(PRIYA.idempotencyKey);
  });

  it('follows the HATEOAS link in a duplicate rejection and returns the original batch', async () => {
    const { rail, fetch } = harness(
      withToken((request) => {
        if (request.url === ORIGINAL_BATCH_URL) return batch(ORIGINAL_BATCH_ID);
        return json(DUPLICATE, 400);
      }),
    );

    const result = await rail.submit(PRIYA);

    expect(result.payoutBatchId).toBe(ORIGINAL_BATCH_ID);
    const posts = fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(posts).toHaveLength(1);
    const gets = fetch.calls.filter((call) => call.url === ORIGINAL_BATCH_URL);
    expect(gets).toHaveLength(1);
    expect(gets[0]!.method).toBe('GET');
  });

  it('falls back to the batch id in the link when the follow-up GET fails', async () => {
    const { rail } = harness(
      withToken((request) => {
        if (request.url === ORIGINAL_BATCH_URL) return json(SERVER_ERROR, 500);
        return json(DUPLICATE, 400);
      }),
    );

    await expect(rail.submit(PRIYA)).resolves.toMatchObject({ payoutBatchId: ORIGINAL_BATCH_ID });
  });

  it('refuses to guess when PayPal reports a duplicate without a link', async () => {
    const noLink = structuredClone(DUPLICATE) as any;
    delete noLink.details[0].link;
    noLink.links = [];
    const { rail } = harness(withToken(() => json(noLink, 400)));

    await expect(rail.submit(PRIYA)).rejects.toMatchObject({ kind: 'duplicate_without_link' });
  });

  it('reads a link from details[].link[], details[].links[] or top-level links[]', async () => {
    const shapes: Array<(body: any) => void> = [
      (body) => {
        body.details[0].link = [{ href: ORIGINAL_BATCH_URL, rel: 'self', method: 'GET' }];
      },
      (body) => {
        delete body.details[0].link;
        body.details[0].links = [{ href: ORIGINAL_BATCH_URL, rel: 'self', method: 'GET' }];
      },
      (body) => {
        delete body.details[0].link;
        body.links = [{ href: ORIGINAL_BATCH_URL, rel: 'self', method: 'GET' }];
      },
    ];

    for (const shape of shapes) {
      const body = structuredClone(DUPLICATE) as any;
      shape(body);
      const { rail } = harness(
        withToken((request) => (request.url === ORIGINAL_BATCH_URL ? batch(ORIGINAL_BATCH_ID) : json(body, 400))),
      );
      await expect(rail.submit(PRIYA)).resolves.toMatchObject({ payoutBatchId: ORIGINAL_BATCH_ID });
    }
  });
});

describe('submit: transient failures', () => {
  it('retries a 5xx with the same key after 2 s and 4 s, then succeeds', async () => {
    let payoutCalls = 0;
    const { rail, fetch, sleeps } = harness(
      withToken(() => {
        payoutCalls += 1;
        return payoutCalls < 3 ? json(SERVER_ERROR, 500) : created();
      }),
    );

    const result = await rail.submit(PRIYA);

    expect(result.payoutBatchId).toBe(CREATED_BATCH_ID);
    const posts = fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((call) => call.headers['paypal-request-id']))).toEqual(new Set([PRIYA.idempotencyKey]));
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('gives up after three retries with the same key and a human message', async () => {
    const { rail, fetch, sleeps } = harness(withToken(() => json(SERVER_ERROR, 500)));

    const error = await rail.submit(PRIYA).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PayPalRailError);
    expect(error).toMatchObject({ kind: 'unavailable', retryable: true });
    expect((error as Error).message).toMatch(/not answering right now/i);
    expect(fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'))).toHaveLength(4);
    expect(sleeps).toEqual([2000, 4000, 8000]);
  });

  it('after a lost response, the same key resend recovers the original batch — one payout, not two', async () => {
    const world = paypalWorld();
    let firstPost = true;
    const { rail, fetch } = harness(
      withToken((request) => {
        if (request.url === ORIGINAL_BATCH_URL) return batch(ORIGINAL_BATCH_ID);
        if (request.method === 'POST' && request.url.endsWith('/v1/payments/payouts')) {
          const senderBatchId = (JSON.parse(request.body ?? '{}') as any).sender_batch_header.sender_batch_id;
          if (firstPost) {
            firstPost = false;
            world.create(senderBatchId);
            throw new TypeError('socket hang up'); // PayPal took it; the answer never arrived
          }
          if (world.batches.has(senderBatchId)) return json(DUPLICATE, 400);
          world.create(senderBatchId);
          return created();
        }
        return json({}, 404);
      }),
    );

    await expect(rail.submit(PRIYA)).rejects.toMatchObject({ kind: 'network', retryable: true });
    const recovered = await rail.submit(PRIYA);

    expect(recovered.payoutBatchId).toBe(ORIGINAL_BATCH_ID);
    expect(world.batches.size).toBe(1);
    const posts = fetch.calls.filter((call) => call.url.endsWith('/v1/payments/payouts'));
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers['paypal-request-id']).toBe(posts[1]!.headers['paypal-request-id']);
    expect(posts[0]!.body).toBe(posts[1]!.body);
  });
});

describe('fault injection (SPEC §6.5.4)', () => {
  it('drops the 201 once and lets the same key recover the batch', async () => {
    const world = paypalWorld();
    const { rail } = harness(
      withToken((request) => {
        if (request.url === ORIGINAL_BATCH_URL) return batch(ORIGINAL_BATCH_ID);
        if (request.method === 'POST') {
          const key = (JSON.parse(request.body ?? '{}') as any).sender_batch_header.sender_batch_id;
          if (world.batches.has(key)) return json(DUPLICATE, 400);
          world.create(key);
          return created();
        }
        return json({}, 404);
      }),
      { env: env({ PBP_FAULT: 'drop_after_submit' }) },
    );

    await expect(rail.submit(PRIYA)).rejects.toMatchObject({ kind: 'lost_response' });
    expect(world.batches.size).toBe(1); // the batch exists: dropping the answer must not undo it

    const recovered = await rail.submit(PRIYA);
    expect(recovered.payoutBatchId).toBe(ORIGINAL_BATCH_ID);
    expect(world.batches.size).toBe(1);
  });

  it('drop_after_submit:first fires once, then leaves later intents alone', async () => {
    const world = paypalWorld();
    const { rail } = harness(
      withToken((request) => {
        if (request.method === 'POST') {
          const key = (JSON.parse(request.body ?? '{}') as any).sender_batch_header.sender_batch_id;
          world.create(key);
          return created(key === PRIYA.idempotencyKey ? 'FIRST' : 'SECOND');
        }
        return json({}, 404);
      }),
      { env: env({ PBP_FAULT: 'drop_after_submit:first' }) },
    );

    await expect(rail.submit(PRIYA)).rejects.toMatchObject({ kind: 'lost_response' });
    const second: PayPalIntent = { ...PRIYA, intentId: 'int_sofia', idempotencyKey: 'pbp-second-key-000000000000000000' };
    await expect(rail.submit(second)).resolves.toMatchObject({ payoutBatchId: 'SECOND' });
    expect(world.batches.size).toBe(2);
  });

  it('drop_after_submit:<intentId> fires only for that intent', async () => {
    const { rail } = harness(withToken(() => created()), { env: env({ PBP_FAULT: `drop_after_submit:${PRIYA.intentId}` }) });

    await expect(rail.submit(PRIYA)).rejects.toMatchObject({ kind: 'lost_response' });

    const other: PayPalIntent = { ...PRIYA, intentId: 'int_other', idempotencyKey: 'pbp-other-key-0000000000000000000' };
    await expect(rail.submit(other)).resolves.toMatchObject({ payoutBatchId: CREATED_BATCH_ID });
  });
});
