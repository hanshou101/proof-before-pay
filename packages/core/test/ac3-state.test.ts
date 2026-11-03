// AC-3 — the state machine.
//
// Every (state × trigger) pair is enumerated, not sampled: a pair listed in the SPEC §6.3.3
// table must move to the stated state, everything else must throw IllegalTransitionError.
// `proven` additionally requires SUCCESS + a transaction id + source rail_get, which is
// enforced when the ledger is replayed (the event carries those three fields).

import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  appendEvent,
  approveBlockedBy,
  evaluate,
  replay,
  transition,
} from '../src/index.ts';
import type { IntentState, LedgerEvent, TransitionTrigger } from '../src/index.ts';
import { EPOCH, baseContext, proposalOf } from './fixtures.ts';

type State = IntentState | null;

const STATES: readonly State[] = [
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

const TRIGGERS: readonly { key: string; trigger: TransitionTrigger }[] = [
  { key: 'intent.proposed', trigger: { kind: 'intent.proposed' } },
  { key: 'intent.checked:approved', trigger: { kind: 'intent.checked', decision: 'approved' } },
  { key: 'intent.checked:held', trigger: { kind: 'intent.checked', decision: 'held' } },
  { key: 'intent.checked:blocked', trigger: { kind: 'intent.checked', decision: 'blocked' } },
  { key: 'payment.submitted', trigger: { kind: 'payment.submitted' } },
  { key: 'receipt.updated:proven', trigger: { kind: 'receipt.updated', proof: 'proven' } },
  { key: 'receipt.updated:pending', trigger: { kind: 'receipt.updated', proof: 'pending' } },
  { key: 'receipt.updated:failed', trigger: { kind: 'receipt.updated', proof: 'failed' } },
  { key: 'receipt.updated:cancelled', trigger: { kind: 'receipt.updated', proof: 'cancelled' } },
  {
    key: 'human.action:verify_payee:confirmed',
    trigger: { kind: 'human.action', action: 'verify_payee', result: 'confirmed' },
  },
  {
    key: 'human.action:verify_payee:not_confirmed',
    trigger: { kind: 'human.action', action: 'verify_payee', result: 'not_confirmed' },
  },
  { key: 'human.action:accept_delivery', trigger: { kind: 'human.action', action: 'accept_delivery' } },
  { key: 'human.action:approve', trigger: { kind: 'human.action', action: 'approve' } },
  { key: 'human.action:reject', trigger: { kind: 'human.action', action: 'reject' } },
  { key: 'human.action:mark_fraud', trigger: { kind: 'human.action', action: 'mark_fraud' } },
  { key: 'human.action:cancel_payout', trigger: { kind: 'human.action', action: 'cancel_payout' } },
  { key: 'human.action:refresh_receipt', trigger: { kind: 'human.action', action: 'refresh_receipt' } },
];

/**
 * The SPEC §6.3.3 table (v1.1), one row per allowed pair.
 * The three "不變" rows are real entries: legal in the listed state, state unchanged.
 * `cancel_payout` no longer cancels by itself — only the rail's `receipt.updated cancelled`
 * (awaiting → cancelled) does, and `cancelled` is terminal.
 */
const ALLOWED: Record<string, IntentState> = {
  'none|intent.proposed': 'proposed',
  'proposed|intent.checked:approved': 'approved',
  'proposed|intent.checked:held': 'held',
  'proposed|intent.checked:blocked': 'blocked',
  'held|human.action:verify_payee:confirmed': 'proposed',
  'held|human.action:verify_payee:not_confirmed': 'held',
  'held|human.action:accept_delivery': 'proposed',
  'held|human.action:approve': 'proposed',
  'held|human.action:reject': 'rejected',
  'held|human.action:mark_fraud': 'rejected',
  'approved|payment.submitted': 'submitted',
  'submitted|payment.submitted': 'submitted',
  'submitted|receipt.updated:proven': 'proven',
  'awaiting|receipt.updated:proven': 'proven',
  'submitted|receipt.updated:pending': 'awaiting',
  'submitted|receipt.updated:failed': 'failed',
  'awaiting|receipt.updated:failed': 'failed',
  'awaiting|human.action:cancel_payout': 'awaiting',
  'awaiting|receipt.updated:cancelled': 'cancelled',
  'submitted|human.action:refresh_receipt': 'submitted',
  'awaiting|human.action:refresh_receipt': 'awaiting',
  'proven|human.action:refresh_receipt': 'proven',
  'failed|human.action:refresh_receipt': 'failed',
  'cancelled|human.action:refresh_receipt': 'cancelled',
};

describe('AC-3 every transition in and outside the table', () => {
  for (const from of STATES) {
    it(`from ${from ?? '(none)'}`, () => {
      const wrong: string[] = [];
      for (const { key, trigger } of TRIGGERS) {
        const expected = ALLOWED[`${from ?? 'none'}|${key}`];
        if (expected === undefined) {
          try {
            const next = transition(from, trigger);
            wrong.push(`${key} should have thrown but returned ${next}`);
          } catch (error) {
            if (!(error instanceof IllegalTransitionError)) {
              wrong.push(`${key} threw ${(error as Error).name}, expected IllegalTransitionError`);
            }
          }
        } else {
          try {
            const next = transition(from, trigger);
            if (next !== expected) wrong.push(`${key} returned ${next}, expected ${expected}`);
          } catch (error) {
            wrong.push(`${key} threw ${(error as Error).message}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  it('covers the whole matrix', () => {
    expect(STATES.length * TRIGGERS.length).toBe(187);
    expect(Object.keys(ALLOWED)).toHaveLength(24);
  });

  it('carries the from-state and trigger on the error', () => {
    try {
      transition('proven', { kind: 'payment.submitted' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const illegal = error as IllegalTransitionError;
      expect(illegal.from).toBe('proven');
      expect(illegal.trigger.kind).toBe('payment.submitted');
    }
  });
});

describe('AC-3 held never leaves held without a human', () => {
  it('holds in_04 and in_05 and refuses to send them', () => {
    for (const itemId of ['in_04', 'in_05']) {
      const { decision } = evaluate(proposalOf(itemId), baseContext());
      expect(decision, itemId).toBe('held');
      expect(() => transition('held', { kind: 'payment.submitted' })).toThrow(IllegalTransitionError);
      expect(() => transition('held', { kind: 'intent.checked', decision: 'approved' })).toThrow(
        IllegalTransitionError,
      );
    }
  });

  it('blocks approve while P1 or P2 holds, and clears only after verify_payee confirmed', () => {
    const before = evaluate(proposalOf('in_04'), baseContext());
    expect(approveBlockedBy(before.checks)?.id).toBe('P1');

    // The human verified the new account by phone: the request becomes confirmed and the
    // on-file payee becomes the verified one (SPEC §6.3.3).
    const after = baseContext();
    const ana = after.vendors.find((vendor) => vendor.id === 'ven_ana');
    if (!ana) throw new Error('missing vendor');
    ana.payee = { rail: 'paypal', recipientType: 'EMAIL', receiver: 'billing@studi0-north.example' };
    after.changeRequests = after.changeRequests.map((request) => ({ ...request, status: 'confirmed' }));

    const rechecked = evaluate(proposalOf('in_04'), after);
    expect(rechecked.decision).toBe('approved');
    expect(approveBlockedBy(rechecked.checks)).toBeNull();
  });
});

describe('AC-3 proven needs rail proof', () => {
  const events: LedgerEvent[] = [];
  let prev: LedgerEvent | null = null;
  const push = (type: Parameters<typeof appendEvent>[1]['type'], data: unknown, at: string) => {
    prev = appendEvent(prev, { type, data, at });
    events.push(prev);
  };

  push('ledger.opened', { epoch: EPOCH, scenario: 'test', version: '1.0.0' }, '2026-11-06T09:00:00Z');
  push(
    'intent.proposed',
    {
      intentId: 'intent_1',
      itemId: 'in_02',
      vendorId: 'ven_kenji',
      agreementId: 'agr_kenji_12',
      agreementMatchedBy: 'po',
      amount: 135000,
      payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'kenji@kenjimotion.example' },
      fingerprint: 'f'.repeat(64),
      idempotencyKey: 'pbp-0123456789abcdef0123456789ab',
    },
    '2026-11-06T09:00:01Z',
  );
  push('intent.checked', { intentId: 'intent_1', checks: [], decision: 'approved' }, '2026-11-06T09:00:02Z');
  push(
    'payment.submitted',
    { intentId: 'intent_1', rail: 'paypal', senderBatchId: 'pbp-x', payoutBatchId: 'BATCH1', attempt: 1 },
    '2026-11-06T09:00:03Z',
  );

  const baseReceipt = {
    intentId: 'intent_1',
    railStatus: 'SUCCESS',
    proof: 'proven' as const,
    payoutItemId: 'ITEM1',
    transactionId: 'TX123',
    source: 'rail_get',
    fetchedAt: '2026-11-06T09:00:05Z',
  };

  it('accepts SUCCESS + transaction id + rail_get', () => {
    const withReceipt = [...events, appendEvent(events.at(-1) ?? null, {
      type: 'receipt.updated',
      data: baseReceipt,
      at: '2026-11-06T09:00:05Z',
    })];
    const projection = replay(withReceipt);
    expect(projection.intents.intent_1?.state).toBe('proven');
    expect(projection.totals.proven).toEqual({ count: 1, amount: 135000 });
  });

  it('refuses proven without a transaction id', () => {
    const withReceipt = [...events, appendEvent(events.at(-1) ?? null, {
      type: 'receipt.updated',
      data: { ...baseReceipt, transactionId: '' },
      at: '2026-11-06T09:00:05Z',
    })];
    const projection = replay(withReceipt);
    expect(projection.intents.intent_1?.state).toBe('submitted');
    expect(projection.totals.proven.count).toBe(0);
    expect(projection.errors).toHaveLength(1);
  });

  it('refuses proven when the source is not rail_get', () => {
    const withReceipt = [...events, appendEvent(events.at(-1) ?? null, {
      type: 'receipt.updated',
      data: { ...baseReceipt, source: 'post_response' },
      at: '2026-11-06T09:00:05Z',
    })];
    const projection = replay(withReceipt);
    expect(projection.intents.intent_1?.state).toBe('submitted');
    expect(projection.errors[0]?.message).toContain('rail_get');
  });

  it('refuses proven when the rail status is not SUCCESS', () => {
    const withReceipt = [...events, appendEvent(events.at(-1) ?? null, {
      type: 'receipt.updated',
      data: { ...baseReceipt, railStatus: 'UNCLAIMED' },
      at: '2026-11-06T09:00:05Z',
    })];
    const projection = replay(withReceipt);
    expect(projection.intents.intent_1?.state).toBe('submitted');
    expect(projection.errors).toHaveLength(1);
  });

  it('the human steps in the scenario produce the documented totals', () => {
    // Walk in_05 through the four human steps the scenario lists, ending at proven 192000.
    let chain: LedgerEvent | null = null;
    const list: LedgerEvent[] = [];
    const add = (type: Parameters<typeof appendEvent>[1]['type'], data: unknown, at: string) => {
      chain = appendEvent(chain, { type, data, at });
      list.push(chain);
    };
    add('ledger.opened', { epoch: EPOCH, scenario: 'test', version: '1.0.0' }, '2026-11-06T09:00:00Z');
    add(
      'intent.proposed',
      {
        intentId: 'intent_leo',
        itemId: 'in_05',
        vendorId: 'ven_leo',
        agreementId: 'agr_leo_02',
        agreementMatchedBy: 'po',
        amount: 240000,
        payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'leo@polyform3d.example' },
        fingerprint: 'a'.repeat(64),
        idempotencyKey: 'pbp-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      '2026-11-06T09:00:01Z',
    );
    add('intent.checked', { intentId: 'intent_leo', checks: [], decision: 'held' }, '2026-11-06T09:00:02Z');
    expect(replay(list).totals.held).toEqual({ count: 1, amount: 240000 });

    // Step 3: accept the delivery → back to proposed, re-checked (O2 still OVER_CAP) → held.
    add(
      'human.action',
      { intentId: 'intent_leo', action: 'accept_delivery', by: 'Maya', input: { deliveryId: 'del_leo_02' } },
      '2026-11-06T09:05:00Z',
    );
    add('intent.checked', { intentId: 'intent_leo', checks: [], decision: 'held' }, '2026-11-06T09:05:01Z');
    expect(replay(list).totals.held).toEqual({ count: 1, amount: 240000 });

    // Step 4: approve at the contract cap → re-check with the lower amount → approved.
    add(
      'human.action',
      { intentId: 'intent_leo', action: 'approve', by: 'Maya', input: { amount: 192000 } },
      '2026-11-06T09:06:00Z',
    );
    add('intent.checked', { intentId: 'intent_leo', checks: [], decision: 'approved' }, '2026-11-06T09:06:01Z');
    add(
      'payment.submitted',
      { intentId: 'intent_leo', rail: 'paypal', senderBatchId: 'pbp-b', payoutBatchId: 'B2', attempt: 1 },
      '2026-11-06T09:06:02Z',
    );
    add(
      'receipt.updated',
      {
        intentId: 'intent_leo',
        railStatus: 'SUCCESS',
        proof: 'proven',
        payoutItemId: 'I2',
        transactionId: 'TX-LEO',
        source: 'rail_get',
        fetchedAt: '2026-11-06T09:06:10Z',
      },
      '2026-11-06T09:06:10Z',
    );
    const projection = replay(list);
    expect(projection.intents.intent_leo?.state).toBe('proven');
    expect(projection.totals.proven).toEqual({ count: 1, amount: 192000 });
    expect(projection.totals.held.count).toBe(0);
  });
});
