// 返工 · 第 1 輪 — 主控 2026-10-22 判定不通過的四項，逐條變成測試。
//
//   1. L2 判「真正會付出去的金額」：本筆用 approvedAmount ?? total，todayTotal 裡每一筆
//      也取 approvedAmount ?? amount（SPEC v1.1 §6.2.2 最後一條）。
//   2. context.history 一律當 proven，不看記錄上帶的 state（SPEC §6.2.2 O4、L2）。
//   3. cancel_payout 只記事件、不改狀態；awaiting → cancelled 只能由 receipt.updated 觸發。
//   4. 只記事件的人工操作（verify_payee not_confirmed / cancel_payout / refresh_receipt）
//      只在表列狀態合法，其餘拋錯；replay 一律經過 transition()。
//
// 這些情境直接取自主控的探針 probe-t2.mjs，數值照 SPEC v1.1。

import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  appendEvent,
  evaluate,
  fingerprint,
  idempotencyKey,
  replay,
  transition,
} from '../src/index.ts';
import type {
  CheckResult,
  GateContext,
  IntentRecord,
  IntentState,
  LedgerEvent,
  TransitionTrigger,
} from '../src/index.ts';
import { EPOCH, baseContext, proposalOf, scenario } from './fixtures.ts';

function checksById(checks: readonly CheckResult[]): Record<string, CheckResult> {
  return Object.fromEntries(checks.map((check) => [check.id, check]));
}

/** A booked intent on the test clock's UTC day. */
function bookedToday(amount: number, overrides: Partial<IntentRecord> = {}): IntentRecord {
  return {
    id: `intent_today_${amount}`,
    itemId: 'in_history',
    vendorId: 'ven_priya',
    agreementId: 'agr_priya_03',
    amount,
    currency: 'USD',
    payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'priya@nairwords.example' },
    fingerprint: `fp_today_${amount}`,
    idempotencyKey: `pbp-today-${amount}`,
    state: 'proven',
    at: '2026-11-06T08:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. L2 judges the money that actually leaves the account
// ---------------------------------------------------------------------------

describe('返工 1 · L2 用真正會付出去的金額', () => {
  /** in_05 approved at the 32 h contract cap (192000), delivery accepted, one payment booked today. */
  function leoContext(paidToday: number): GateContext {
    const context = baseContext();
    const delivery = context.deliveries.find((entry) => entry.id === 'del_leo_02');
    if (!delivery) throw new Error('missing del_leo_02');
    delivery.acceptedAt = '2026-11-06T09:05:00Z';
    delivery.acceptedBy = 'Maya';
    context.approvedAmount = 192000;
    context.approvedBy = 'Maya';
    context.intents = [...context.intents, bookedToday(paidToday)];
    return context;
  }

  it('probe 1: 800000 already paid + 192000 approved ≤ 1000000 daily limit → approved', () => {
    const { checks, decision } = evaluate(proposalOf('in_05'), leoContext(800000));
    const l2 = checksById(checks).L2;
    expect(l2?.status).toBe('pass');
    expect(l2?.code).toBe('WITHIN_DAILY_LIMIT');
    expect(l2?.facts).toMatchObject({ todayTotal: 800000, amount: 192000, limit: 1000000 });
    expect(decision).toBe('approved');
  });

  it('boundary: 808000 + 192000 = 1000000 passes, 808001 holds', () => {
    const atLimit = evaluate(proposalOf('in_05'), leoContext(808000));
    expect(checksById(atLimit.checks).L2?.status).toBe('pass');
    expect(atLimit.decision).toBe('approved');

    const over = evaluate(proposalOf('in_05'), leoContext(808001));
    expect(checksById(over.checks).L2?.status).toBe('hold');
    expect(checksById(over.checks).L2?.code).toBe('OVER_DAILY_LIMIT');
    expect(over.decision).toBe('held');
  });

  it("counts each booked intent at its own approvedAmount, not its billed amount", () => {
    const context = leoContext(0);
    context.intents = [...context.intents, bookedToday(800000, { approvedAmount: 500000 })];
    const { checks } = evaluate(proposalOf('in_05'), context);
    expect(checksById(checks).L2?.facts.todayTotal).toBe(500000);
    expect(checksById(checks).L2?.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// 2. Seeded history is always proven, whatever the record carries
// ---------------------------------------------------------------------------

describe('返工 2 · 歷史紀錄一律當 proven', () => {
  /** Exactly what scenario.json's `history[0]` says — no `state` field at all. */
  function seededHistory(state?: string): IntentRecord {
    const hist = scenario.history[0];
    if (!hist) throw new Error('scenario.json has no seeded history');
    const fp = fingerprint({
      vendorId: hist.vendorId,
      invoiceNumber: hist.invoiceNumber,
      currency: hist.currency,
      total: hist.total,
    });
    const record = {
      id: hist.id,
      itemId: hist.id,
      vendorId: hist.vendorId,
      agreementId: hist.agreementId,
      amount: hist.total,
      currency: hist.currency,
      payee: null,
      fingerprint: fp,
      idempotencyKey: idempotencyKey(EPOCH, fp),
      at: '2026-11-02T09:15:00Z',
      ...(state === undefined ? {} : { state }),
    };
    return record as unknown as IntentRecord;
  }

  it('probe 2a: history without a state field still blocks in_03 with DUPLICATE', () => {
    const context = baseContext();
    // Only `history` carries the seeded payment here, exactly like the server after a reset.
    // (`baseContext()` also keeps it in `intents`; leaving it there would mask the bug.)
    context.intents = [];
    context.history = [seededHistory()];
    const { checks, decision } = evaluate(proposalOf('in_03'), context);
    const o4 = checksById(checks).O4;
    expect(o4?.status).toBe('fail');
    expect(o4?.code).toBe('DUPLICATE');
    expect(o4?.facts.duplicateOf).toBe('hist_kenji_0142');
    expect(o4?.facts.originalState).toBe('proven');
    expect(decision).toBe('blocked');
  });

  it('probe 2b: history carrying any other state is still proven', () => {
    for (const state of ['proven', 'rejected', 'failed', 'cancelled', 'held', 'nonsense']) {
      const context = baseContext();
      context.intents = [];
      context.history = [seededHistory(state)];
      const { checks, decision } = evaluate(proposalOf('in_03'), context);
      const o4 = checksById(checks).O4;
      expect(o4?.code, state).toBe('DUPLICATE');
      expect(o4?.facts.originalState, state).toBe('proven');
      expect(decision, state).toBe('blocked');
    }
  });

  it('L2 also counts a history record that carries no state (or a non-proven one)', () => {
    for (const state of [undefined, 'rejected']) {
      const context = baseContext();
      const hist = seededHistory(state);
      context.history = [{ ...hist, amount: 800000, at: '2026-11-06T08:00:00Z' }];
      const { checks } = evaluate(proposalOf('in_08'), context);
      expect(checksById(checks).L2?.facts.todayTotal, String(state)).toBe(800000);
      expect(checksById(checks).L2?.status, String(state)).toBe('pass');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Cancel needs proof: cancel_payout records, only the receipt moves the state
// ---------------------------------------------------------------------------

describe('返工 3 · 取消要等回執才算 cancelled', () => {
  function ledgerOf(steps: [LedgerEvent['type'], unknown][]): LedgerEvent[] {
    let prev: LedgerEvent | null = null;
    const events: LedgerEvent[] = [];
    for (const [type, data] of steps) {
      prev = appendEvent(prev, { type, data, at: '2026-11-06T10:00:00Z' });
      events.push(prev);
    }
    return events;
  }

  const base: [LedgerEvent['type'], unknown][] = [
    ['ledger.opened', { epoch: EPOCH, scenario: 'rework', version: '1.1.0' }],
    [
      'intent.proposed',
      {
        intentId: 'i7',
        itemId: 'in_07',
        vendorId: 'ven_jonas',
        agreementId: 'agr_jonas_01',
        agreementMatchedBy: 'po',
        amount: 64000,
        payee: null,
        fingerprint: 'f',
        idempotencyKey: 'k',
      },
    ],
    ['intent.checked', { intentId: 'i7', checks: [], decision: 'approved' }],
    ['payment.submitted', { intentId: 'i7', rail: 'paypal', senderBatchId: 'k', payoutBatchId: 'B', attempt: 1 }],
    [
      'receipt.updated',
      {
        intentId: 'i7',
        railStatus: 'UNCLAIMED',
        proof: 'pending',
        payoutItemId: 'I',
        transactionId: null,
        source: 'rail_get',
        fetchedAt: 't',
      },
    ],
  ];
  const cancel: [LedgerEvent['type'], unknown] = [
    'human.action',
    { intentId: 'i7', action: 'cancel_payout', by: 'Maya', input: null },
  ];
  const success: [LedgerEvent['type'], unknown] = [
    'receipt.updated',
    {
      intentId: 'i7',
      railStatus: 'SUCCESS',
      proof: 'proven',
      payoutItemId: 'I',
      transactionId: 'TX9',
      source: 'rail_get',
      fetchedAt: 't2',
    },
  ];
  const cancelled: [LedgerEvent['type'], unknown] = [
    'receipt.updated',
    {
      intentId: 'i7',
      railStatus: 'RETURNED',
      proof: 'cancelled',
      payoutItemId: 'I',
      transactionId: null,
      source: 'rail_get',
      fetchedAt: 't3',
    },
  ];

  it('probe 3a: a recorded cancel leaves the intent awaiting, nothing in Stopped', () => {
    const projection = replay(ledgerOf([...base, cancel]));
    expect(projection.intents.i7?.state).toBe('awaiting');
    expect(projection.totals.stopped).toEqual({ count: 0, amount: 0 });
    expect(projection.totals.awaitingProof).toEqual({ count: 1, amount: 64000 });
    expect(projection.intents.i7?.humanActions.map((action) => action.action)).toEqual(['cancel_payout']);
  });

  it('probe 3b: the recipient claimed first — the SUCCESS receipt still makes it proven', () => {
    const projection = replay(ledgerOf([...base, cancel, success]));
    expect(projection.intents.i7?.state).toBe('proven');
    expect(projection.totals.proven).toEqual({ count: 1, amount: 64000 });
  });

  it('a RETURNED receipt from our own cancel moves awaiting → cancelled', () => {
    const projection = replay(ledgerOf([...base, cancel, cancelled]));
    expect(projection.intents.i7?.state).toBe('cancelled');
    expect(projection.totals.stopped).toEqual({ count: 1, amount: 64000 });
  });

  it('cancelled is terminal: a later cancelled receipt is an illegal transition', () => {
    expect(() => transition('cancelled', { kind: 'receipt.updated', proof: 'cancelled' })).toThrow(
      IllegalTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Event-only human actions are only legal in the states the table lists
// ---------------------------------------------------------------------------

describe('返工 4 · 只記事件的人工操作受狀態限制', () => {
  const STATES: readonly (IntentState | null)[] = [
    null,
    'proposed',
    'approved',
    'held',
    'blocked',
    'submitted',
    'awaiting',
    'proven',
    'failed',
    'cancelled',
    'rejected',
  ];

  const NO_OP_ACTIONS: readonly { key: string; trigger: TransitionTrigger; allowed: readonly (IntentState | null)[] }[] = [
    {
      key: 'verify_payee(not_confirmed)',
      trigger: { kind: 'human.action', action: 'verify_payee', result: 'not_confirmed' },
      allowed: ['held'],
    },
    {
      key: 'cancel_payout',
      trigger: { kind: 'human.action', action: 'cancel_payout' },
      allowed: ['awaiting'],
    },
    {
      key: 'refresh_receipt',
      trigger: { kind: 'human.action', action: 'refresh_receipt' },
      allowed: ['submitted', 'awaiting', 'proven', 'failed', 'cancelled'],
    },
  ];

  for (const { key, trigger, allowed } of NO_OP_ACTIONS) {
    it(`${key}: state unchanged in the listed states, throws everywhere else`, () => {
      for (const from of STATES) {
        const listed = allowed.includes(from);
        if (listed) {
          expect(transition(from, trigger), `${key} from ${from ?? '(none)'}`).toBe(from);
        } else {
          expect(() => transition(from, trigger), `${key} from ${from ?? '(none)'}`).toThrow(
            IllegalTransitionError,
          );
        }
      }
    });
  }

  function ledgerOf(steps: [LedgerEvent['type'], unknown][]): LedgerEvent[] {
    let prev: LedgerEvent | null = null;
    const events: LedgerEvent[] = [];
    for (const [type, data] of steps) {
      prev = appendEvent(prev, { type, data, at: '2026-11-06T10:00:00Z' });
      events.push(prev);
    }
    return events;
  }

  const proposed: [LedgerEvent['type'], unknown][] = [
    ['ledger.opened', { epoch: EPOCH, scenario: 'rework', version: '1.1.0' }],
    [
      'intent.proposed',
      {
        intentId: 'i7',
        itemId: 'in_07',
        vendorId: 'ven_jonas',
        agreementId: 'agr_jonas_01',
        agreementMatchedBy: 'po',
        amount: 64000,
        payee: null,
        fingerprint: 'f',
        idempotencyKey: 'k',
      },
    ],
    ['intent.checked', { intentId: 'i7', checks: [], decision: 'approved' }],
    ['payment.submitted', { intentId: 'i7', rail: 'paypal', senderBatchId: 'k', payoutBatchId: 'B', attempt: 1 }],
  ];
  const proven: [LedgerEvent['type'], unknown] = [
    'receipt.updated',
    {
      intentId: 'i7',
      railStatus: 'SUCCESS',
      proof: 'proven',
      payoutItemId: 'I',
      transactionId: 'TX9',
      source: 'rail_get',
      fetchedAt: 't2',
    },
  ];

  it('probe 4a: replay refuses verify_payee(not_confirmed) on a proven intent', () => {
    const events = ledgerOf([
      ...proposed,
      proven,
      ['human.action', { intentId: 'i7', action: 'verify_payee', by: 'Maya', input: { result: 'not_confirmed' } }],
    ]);
    expect(() => replay(events)).toThrow(IllegalTransitionError);
  });

  it('probe 4b: replay refuses refresh_receipt on a held intent that was never sent', () => {
    const events = ledgerOf([
      ['ledger.opened', { epoch: EPOCH, scenario: 'rework', version: '1.1.0' }],
      ['intent.proposed', { intentId: 'i7', itemId: 'in_07', vendorId: 'ven_jonas', agreementId: null, agreementMatchedBy: null, amount: 64000, payee: null, fingerprint: 'f', idempotencyKey: 'k' }],
      ['intent.checked', { intentId: 'i7', checks: [], decision: 'held' }],
      ['human.action', { intentId: 'i7', action: 'refresh_receipt', by: 'Maya', input: null }],
    ]);
    expect(() => replay(events)).toThrow(IllegalTransitionError);
  });

  it('replay accepts refresh_receipt on every state the table lists', () => {
    // submitted → awaiting → proven, refreshing after each move.
    const events = ledgerOf([
      ...proposed,
      ['human.action', { intentId: 'i7', action: 'refresh_receipt', by: 'Maya', input: null }],
      ['receipt.updated', { intentId: 'i7', railStatus: 'UNCLAIMED', proof: 'pending', payoutItemId: 'I', transactionId: null, source: 'rail_get', fetchedAt: 't1' }],
      ['human.action', { intentId: 'i7', action: 'refresh_receipt', by: 'Maya', input: null }],
      proven,
      ['human.action', { intentId: 'i7', action: 'refresh_receipt', by: 'Maya', input: null }],
    ]);
    const projection = replay(events);
    expect(projection.intents.i7?.state).toBe('proven');
    expect(projection.intents.i7?.humanActions).toHaveLength(3);
  });
});
