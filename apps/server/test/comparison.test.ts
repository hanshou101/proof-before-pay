// AC-14 (server side) and SPEC §6.3.2: comparison mode is off by default, sends exactly the
// payouts the ungated agent asked for, and leaves the proof ledger untouched.

import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness } from './harness.js';

const harnesses: ReturnType<typeof makeHarness>[] = [];

afterAll(() => {
  for (const harness of harnesses) harness.close();
});

describe('comparison mode', () => {
  it('is refused unless PBP_ALLOW_COMPARISON=1', async () => {
    const harness = makeHarness({ allowComparison: false });
    harnesses.push(harness);

    const response = await harness.post('/api/runs', { mode: 'comparison' });
    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Comparison mode is off');
    expect(response.body.error).toContain('nothing was sent');
    expect(harness.rail.submitCalls).toBe(0);
  });

  it('sends every payment the ungated agent asks for, and records it in its own ledger', async () => {
    const harness = makeHarness({ allowComparison: true });
    harnesses.push(harness);
    expect((await harness.post('/api/demo/reset')).status).toBe(200);

    const before = await harness.get('/api/state');
    const mainHeadBefore = before.body.head;

    expect((await harness.run('comparison')).status).toBe(200);

    const comparison = await harness.get('/api/comparison/state');
    expect(comparison.status).toBe(200);
    expect(comparison.body.verified).toBe(true);

    const golden = harness.built.demo.scenario.golden.comparisonMode.payouts;
    expect(comparison.body.payouts).toHaveLength(golden.length);
    comparison.body.payouts.forEach((payout: any, index: number) => {
      const expected = golden[index];
      expect(expected, `golden payout ${index}`).toBeTruthy();
      expect(payout.receiver).toBe(expected?.receiver);
      expect(payout.amount).toBe(expected?.amount);
    });

    expect(comparison.body.summary.text).toBe('All invoices paid ✅');
    const total = comparison.body.payouts.reduce((sum: number, payout: any) => sum + payout.amount, 0);
    expect(total).toBe(1167800);

    // The main ledger did not move: no run, no intents, same head.
    const after = await harness.get('/api/state');
    expect(after.body.head).toBe(mainHeadBefore);
    expect(Object.keys(after.body.intents)).toHaveLength(0);
    expect(after.body.totals.proven).toEqual({ count: 0, amount: 0 });
  });
});
