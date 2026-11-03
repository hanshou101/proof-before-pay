// SPEC §6.3.3 (v1.1): `cancel_payout` never moves the state by itself. The runner calls the
// rail's cancel and then GETs a receipt; the receipt decides:
//   - RETURNED by our own cancel → cancelled
//   - SUCCESS (the payee claimed it before our cancel reached PayPal) → proven
//   - still UNCLAIMED → stays awaiting, nothing is written
// A refused cancel is exactly the case where the GET matters most: PayPal only cancels an
// UNCLAIMED payout, so "refused" usually means the money already moved.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

// in_07 (Jonas, $640) is the one approved invoice PayPal leaves UNCLAIMED → awaiting after a run.
const JONAS = 'int_in_07';

let harness: Harness;

beforeEach(async () => {
  harness = makeHarness();
  expect((await harness.post('/api/demo/reset')).status).toBe(200);
  expect((await harness.run('proof')).status).toBe(200);
  // The run leaves a background poller on the awaiting payout. Stop it so this file only sees
  // what the action under test writes.
  harness.built.runner.close();
});

afterEach(() => harness.close());

const intents = () => harness.built.runtime.projection.intents as Record<string, { state: string; idempotencyKey: string }>;
interface RecordedEvent {
  type: string;
  data: any;
}
const events = () => harness.built.runtime.events as unknown as RecordedEvent[];
const eventsSince = (length: number) => events().slice(length);

describe('cancel_payout', () => {
  it('(a) a cancel PayPal accepts books the RETURNED receipt and ends cancelled', async () => {
    const before = events().length;
    const response = await harness.post(`/api/intents/${JONAS}/actions`, {
      action: 'cancel_payout',
      input: { reason: 'Duplicate of INV-0142' },
    });

    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('cancelled');

    const added = eventsSince(before);
    expect(added.map((event) => event.type)).toEqual(['human.action', 'receipt.updated']);
    expect(added[0]?.data).toMatchObject({ intentId: JONAS, action: 'cancel_payout' });
    expect(added[1]?.data).toMatchObject({ intentId: JONAS, proof: 'cancelled', railStatus: 'RETURNED' });
  });

  it('(b) a payee who claimed first turns the refused cancel into proven', async () => {
    const intent = intents()[JONAS];
    expect(intent?.state).toBe('awaiting');
    // The payee claimed the payout before our cancel arrived: PayPal already has it as SUCCESS.
    harness.rail.setStatus(intent!.idempotencyKey, 'SUCCESS', 'TXN-CLAIMEDBEFORECANCEL');

    const before = events().length;
    const response = await harness.post(`/api/intents/${JONAS}/actions`, {
      action: 'cancel_payout',
      input: { reason: 'Payee asked us to stop it' },
    });

    // The GET after the refused cancel is what makes this response already final.
    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('proven');
    expect(response.body.intent.receipt.transactionId).toBe('TXN-CLAIMEDBEFORECANCEL');

    const added = eventsSince(before);
    const proofs = added.filter((event) => event.type === 'receipt.updated').map((event) => event.data.proof);
    expect(proofs).toEqual(['proven']);
    expect(proofs).not.toContain('cancelled');
  });

  it('(c) a cancel and a receipt that both fail leave the payment awaiting with an error', async () => {
    harness.rail.armCancelFailure();
    harness.rail.armFetchFailure();

    const before = events().length;
    const response = await harness.post(`/api/intents/${JONAS}/actions`, {
      action: 'cancel_payout',
      input: { reason: 'Try anyway' },
    });

    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('awaiting');

    const added = eventsSince(before);
    expect(added.map((event) => event.type)).toEqual(['human.action', 'error', 'error']);
    expect(added.some((event) => event.type === 'receipt.updated')).toBe(false);
    for (const event of added.filter((entry) => entry.type === 'error')) {
      expect(typeof event.data.message).toBe('string');
      expect(event.data.message.length).toBeGreaterThan(0);
    }
  });
});
