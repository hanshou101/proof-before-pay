// SPEC §6.3.3 + the T8 note (主控 2026-10-29): a cancel that survives a restart.
//
// The PayPal rail remembers "we asked to cancel this item" only inside the process that sent the
// request (`PayPalRail.cancelling`). After a restart that memory is gone, so the same `RETURNED`
// receipt would be read as the 30-day auto-return → `failed`. The ledger is what has to carry the
// fact across: `human.action: cancel_payout` is replayed into the runtime overlay, and the runner
// reads it when it sees `RETURNED`.
//
// The test stages exactly what a crash leaves behind: the action in the ledger, the process gone,
// PayPal reporting `RETURNED`, and a brand-new server over the same data directory.

import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

// in_07 (Jonas, $640) is the one approved invoice PayPal leaves UNCLAIMED → awaiting after a run.
const JONAS = 'int_in_07';

let first: Harness | null = null;
let second: Harness | null = null;

afterEach(() => {
  second?.close();
  first?.close();
  second = null;
  first = null;
});

interface RecordedEvent {
  type: string;
  data: any;
}

describe('cancel then restart', () => {
  it('still ends cancelled when the RETURNED receipt arrives in a new process', async () => {
    first = makeHarness();
    expect((await first.post('/api/demo/reset')).status).toBe(200);
    expect((await first.run('proof')).status).toBe(200);

    const dataDir = first.dataDir;
    const intent = first.built.runtime.projection.intents[JONAS];
    expect(intent?.state).toBe('awaiting');

    // 1. The human asked to cancel, and the process died before PayPal answered. The action is
    //    in the ledger; nothing else is.
    first.built.runtime.append('human.action', {
      intentId: JONAS,
      action: 'cancel_payout',
      by: 'Maya',
      input: { reason: 'Duplicate of INV-0142' },
    });
    const beforeCrash = (first.built.runtime.events as unknown as RecordedEvent[]).length;
    first.built.runner.close();

    // 2. PayPal's side of the story: the payout came back (our cancel landed after the restart).
    first.rail.setStatus(intent!.idempotencyKey, 'RETURNED');

    // 3. A new server process over the same data directory. Its rail has no memory of the cancel.
    second = makeHarness({ dataDir });
    expect(second.built.runtime.projection.intents[JONAS]?.state).toBe('awaiting');
    expect(second.built.runtime.overlay.cancelRequested.has(JONAS)).toBe(true);

    await second.built.runner.recover();

    // The background poller armed by `recover` writes the receipt; wait for it.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && second.built.runtime.intent(JONAS)?.state === 'awaiting') {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const after = second.built.runtime.intent(JONAS);
    expect(after?.state).toBe('cancelled');
    expect(after?.receipt?.railStatus).toBe('RETURNED');
    expect(after?.receipt?.proof).toBe('cancelled');

    const written = (second.built.runtime.events as unknown as RecordedEvent[]).slice(beforeCrash - 1);
    const receipts = written.filter((event) => event.type === 'receipt.updated');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.data).toMatchObject({ intentId: JONAS, proof: 'cancelled', railStatus: 'RETURNED' });

    // And what the screen shows agrees with the ledger.
    const state = await second.get('/api/state');
    expect(state.body.intents[JONAS].state).toBe('cancelled');
    expect(state.body.totals.awaitingProof.count).toBe(0);
  });

  it('reads a RETURNED receipt as failed when nobody asked to cancel', async () => {
    first = makeHarness();
    expect((await first.post('/api/demo/reset')).status).toBe(200);
    expect((await first.run('proof')).status).toBe(200);

    const intent = first.built.runtime.projection.intents[JONAS];
    expect(intent?.state).toBe('awaiting');
    // PayPal's own 30-day auto-return: no `cancel_payout` anywhere in the ledger.
    first.rail.setStatus(intent!.idempotencyKey, 'RETURNED');

    const response = await first.post(`/api/intents/${JONAS}/actions`, { action: 'refresh_receipt' });
    expect(response.status).toBe(200);
    expect(response.body.intent.state).toBe('failed');
    expect(response.body.intent.receipt.proof).toBe('failed');
  });
});
