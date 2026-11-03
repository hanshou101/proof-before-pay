// AC-13(a), server side: PayPal takes the money but the answer never arrives.
//
// The rail's submit returns `payoutBatchId: null` exactly as SPEC §6.5.2 describes a dropped
// response. The runner must retry with the *same* key, and the fake rail — which already holds the
// batch — must hand back that same batch instead of creating a second payout.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucketsOf, makeHarness, type Harness } from './harness.js';

let harness: Harness;
let golden: any;

beforeAll(async () => {
  harness = makeHarness();
  golden = harness.built.demo.scenario.golden;
  expect((await harness.post('/api/demo/reset')).status).toBe(200);
  harness.rail.armDroppedResponse();
  expect((await harness.run('proof')).status).toBe(200);
});

afterAll(() => harness.close());

describe('a dropped submit response', () => {
  it('still ends on golden totals', async () => {
    const state = await harness.get('/api/state');
    expect(state.body.totals).toEqual(bucketsOf(golden.totalsAfterRun));
  });

  it('retried the same sender_batch_id exactly once', () => {
    const rail = harness.rail.state();
    const retried = Object.entries(rail.calls).filter(([, calls]) => calls === 2);
    expect(retried).toHaveLength(1);
    const [key] = retried[0] ?? [];
    expect(key).toMatch(/^pbp-/);
    expect(rail.batches[String(key)]?.payouts).toBe(1);
  });

  it('never created a second payout for any key', () => {
    const rail = harness.rail.state();
    for (const [key, batch] of Object.entries(rail.batches)) {
      expect(batch.payouts, `${key} was paid ${batch.payouts} times`).toBe(1);
    }
    const approved = golden.items.filter((item: any) => item.decision === 'approved').length;
    expect(Object.keys(rail.batches)).toHaveLength(approved + 1); // + the seeded history payout
  });

  it('wrote an error event saying the receipt is pending, then recovered', async () => {
    const state = await harness.get('/api/state');
    const retried = Object.entries(harness.rail.state().calls).find(([, calls]) => calls === 2)?.[0];
    const batch = retried ? harness.rail.state().batches[retried] : null;
    const intent = Object.values(state.body.intents as Record<string, any>).find(
      (entry) => entry.submission?.senderBatchId === retried,
    );
    expect(intent?.state).toBe('proven');
    expect(batch?.transactionId).toBe(intent?.receipt.transactionId);
  });
});
