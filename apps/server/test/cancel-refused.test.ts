// SPEC v1.7 §6.3.3 / §6.5.1, second half: what a *refused* cancel must leave behind.
//
// T5 proved the sandbox refuses every cancel of an UNCLAIMED payout (400 `BATCH_NOT_COMPLETED`
// while the batch is processing, 500 `INTERNAL_SERVICE_ERROR` once it has completed) and that the
// item stays UNCLAIMED afterwards. The demo therefore has to show "PayPal did not confirm the
// cancellation" — never "Cancelled".
//
// This is the server half of that: one `human.action`, one `error` scoped to the intent, no
// `receipt.updated` with `proof: cancelled`, and the projection still Awaiting proof.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

// in_07 (Jonas, $640) is the one approved invoice PayPal leaves UNCLAIMED → awaiting after a run.
const JONAS = 'int_in_07';

let harness: Harness;

beforeEach(async () => {
  harness = makeHarness();
  expect((await harness.post('/api/demo/reset')).status).toBe(200);
  expect((await harness.run('proof')).status).toBe(200);
  harness.built.runner.close();
});

afterEach(() => harness.close());

interface RecordedEvent {
  type: string;
  data: any;
}

const events = () => harness.built.runtime.events as unknown as RecordedEvent[];

describe('cancel refused by PayPal (recorded 500)', () => {
  it('records one error, keeps the payout awaiting, and never says cancelled', async () => {
    const before = events().length;
    harness.rail.armCancelRefusal();

    const response = await harness.post(`/api/intents/${JONAS}/actions`, {
      action: 'cancel_payout',
      input: { reason: 'Try to cancel an unclaimed payout' },
    });

    expect(response.status).toBe(200);
    // The GET after the refusal is still UNCLAIMED: the payee has not claimed it, and PayPal
    // has not returned it either. So the payment stays exactly where it was.
    expect(response.body.intent.state).toBe('awaiting');

    const added = events().slice(before);
    expect(added.filter((event) => event.type === 'human.action').map((event) => event.data.action)).toEqual([
      'cancel_payout',
    ]);

    // The refusal is on the record, scoped to this intent, with a human sentence (the rail's
    // status code and body belong in `detail`, not in the sentence).
    const errors = added.filter((event) => event.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data.scope).toBe(`cancel:${JONAS}`);
    expect(typeof errors[0]?.data.message).toBe('string');
    expect(errors[0]?.data.message.length).toBeGreaterThan(0);
    expect(errors[0]?.data.message).not.toMatch(/INTERNAL_SERVICE_ERROR|500/);

    // Nothing may claim the payout was cancelled.
    expect(added.some((event) => event.type === 'receipt.updated' && event.data.proof === 'cancelled')).toBe(false);
    expect(events().some((event) => event.data?.proof === 'cancelled')).toBe(false);
  });

  it('still shows Awaiting proof, and no screen may say Cancelled', async () => {
    harness.rail.armCancelRefusal();
    await harness.post(`/api/intents/${JONAS}/actions`, { action: 'cancel_payout', input: {} });

    const state = await harness.get('/api/state');
    expect(state.status).toBe(200);
    expect(state.body.byItem.in_07).toBe(JONAS);
    expect(state.body.intents[JONAS].state).toBe('awaiting');
    expect(state.body.intents[JONAS].receipt.proof).toBe('pending');
    expect(state.body.totals.awaitingProof.count).toBe(1);
    // The sentence the UI shows for this row comes from the ledger's error event.
    const messages = (state.body.errors as { scope: string; message: string }[])
      .filter((entry) => entry.scope === `cancel:${JONAS}`)
      .map((entry) => entry.message);
    expect(messages).toHaveLength(1);
  });
});
