// T8 第 3 輪（2026-10-30 驗收回單）的兩條伺服器行為：
//
//   第 1 項 — 單筆送出的錯誤只屬於那一行；PayPal 拒絕我們的憑證是整輪的事，這一輪要停下來，
//            並用 07-UI §4.5 的原句。它曾經被寫成「PayPal did not answer. We will retry…」，
//            於是跑完、帳也對的一輪，畫面上還是紅色橫幅加「Retry run」。
//   第 3 項 — 對照模式裡某一筆送不出去，不能讓整輪結束：那是模型會看到的工具結果。

import { afterEach, describe, expect, it } from 'vitest';
import { PAYPAL_UNREACHABLE_MESSAGE } from '../src/rail-errors.js';
import { makeHarness, type Harness } from './harness.js';

const harnesses: Harness[] = [];

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.close();
});

function make(options: Parameters<typeof makeHarness>[0] = {}): Harness {
  const harness = makeHarness(options);
  harnesses.push(harness);
  return harness;
}

interface RecordedEvent {
  type: string;
  data: any;
}

const events = (harness: Harness) => harness.built.runtime.events as unknown as RecordedEvent[];

describe('a credential failure stops the run (T8 round 3, item 1)', () => {
  it('records one screen-level error in 07-UI words and does not keep sending', async () => {
    const harness = make();
    expect((await harness.post('/api/demo/reset')).status).toBe(200);
    const before = events(harness).length;

    harness.rail.armCredentialFailure();
    expect((await harness.run('proof')).status).toBe(200);

    const written = events(harness).slice(before);
    const errors = written.filter((event) => event.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data.scope).toBe('run');
    expect(errors[0]?.data.message).toBe(PAYPAL_UNREACHABLE_MESSAGE);

    // The run stopped at the first payout instead of trying the other invoices: one approved
    // intent, no completion, and no per-row "we will retry" prose.
    expect(written.filter((event) => event.type === 'intent.proposed')).toHaveLength(1);
    expect(written.filter((event) => event.type === 'run.completed')).toHaveLength(0);
    expect(written.filter((event) => String(event.data?.scope ?? '').startsWith('payment.submit:'))).toHaveLength(0);
  });

  it('says the same thing in /api/state', async () => {
    const harness = make();
    expect((await harness.post('/api/demo/reset')).status).toBe(200);
    harness.rail.armCredentialFailure();
    expect((await harness.run('proof')).status).toBe(200);

    const snapshot = await harness.get('/api/state');
    const screenErrors = (snapshot.body.errors as { scope: string; message: string }[]).filter(
      (error) => error.scope === 'run',
    );
    expect(screenErrors.map((error) => error.message)).toEqual([PAYPAL_UNREACHABLE_MESSAGE]);
  });
});

describe('a refused payout does not end the comparison run (T8 round 3, item 3)', () => {
  it('records the failure as a tool result and still writes the summary', async () => {
    const harness = make({ allowComparison: true });
    expect((await harness.post('/api/demo/reset')).status).toBe(200);
    harness.rail.armRefusedReceiver('priya@nairwords.example');

    expect((await harness.run('comparison')).status).toBe(200);

    const comparison = await harness.get('/api/comparison/state');
    expect(comparison.status).toBe(200);
    const payouts = comparison.body.payouts as { receiver: string; railStatus: string | null; payoutBatchId: string | null }[];

    // Every invoice the model asked to pay is still listed — including the one PayPal refused.
    expect(payouts).toHaveLength(harness.built.demo.scenario.golden.comparisonMode.payouts.length);
    const refused = payouts.find((payout) => payout.receiver === 'priya@nairwords.example');
    expect(refused?.payoutBatchId).toBeNull();
    expect(refused?.railStatus).toBeNull();
    // … and the run still closed with the agent's own words.
    expect(comparison.body.summary.text).toBe('All invoices paid ✅');
  });
});
