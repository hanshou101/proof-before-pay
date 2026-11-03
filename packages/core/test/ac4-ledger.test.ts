// AC-4 — the ledger cannot be edited quietly.
//
// Every line's hash is computed over the canonical JSON of the line without `hash`, and
// `prevHash` chains to the line before. Four kinds of tampering must each report the first
// `seq` that no longer verifies: changing a line, deleting one, swapping two, inserting one.

import { describe, expect, it } from 'vitest';
import { GENESIS_PREV, appendEvent, canonical, replay, verifyChain } from '../src/index.ts';
import type { EventType, LedgerEvent } from '../src/index.ts';

function buildLedger(): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  let prev: LedgerEvent | null = null;
  const add = (type: EventType, data: unknown, at: string): void => {
    prev = appendEvent(prev, { type, data, at });
    events.push(prev);
  };

  add('ledger.opened', { epoch: 'ep_1', scenario: 'lumen-lark', version: '1.0.0' }, '2026-11-06T09:00:00Z');
  add('run.started', { runId: 'run_1', mode: 'proof', inboxCount: 9 }, '2026-11-06T09:00:01Z');
  add(
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
    '2026-11-06T09:00:02Z',
  );
  add('intent.checked', { intentId: 'intent_1', checks: [], decision: 'approved' }, '2026-11-06T09:00:03Z');
  add(
    'payment.submitted',
    { intentId: 'intent_1', rail: 'paypal', senderBatchId: 'pbp-x', payoutBatchId: 'B1', attempt: 1 },
    '2026-11-06T09:00:04Z',
  );
  add(
    'receipt.updated',
    {
      intentId: 'intent_1',
      railStatus: 'SUCCESS',
      proof: 'proven',
      payoutItemId: 'I1',
      transactionId: 'TX1',
      source: 'rail_get',
      fetchedAt: '2026-11-06T09:00:09Z',
    },
    '2026-11-06T09:00:09Z',
  );
  return events;
}

function clone(events: readonly LedgerEvent[]): LedgerEvent[] {
  return JSON.parse(JSON.stringify(events)) as LedgerEvent[];
}

describe('AC-4 hash chain', () => {
  it('starts from 64 zeros and numbers from 1', () => {
    const events = buildLedger();
    expect(events[0]?.prevHash).toBe(GENESIS_PREV);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('verifies an untouched ledger, as array and as JSONL text', () => {
    const events = buildLedger();
    expect(verifyChain(events)).toEqual({ ok: true });
    expect(verifyChain(events.map((event) => JSON.stringify(event)).join('\n'))).toEqual({ ok: true });
  });

  it('canonical() sorts keys recursively and emits no whitespace', () => {
    expect(canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('reports the edited line', () => {
    const events = clone(buildLedger());
    const target = events[2];
    if (!target) throw new Error('fixture');
    target.data = { ...(target.data as object), amount: 135001 };
    expect(verifyChain(events)).toEqual({ ok: false, seq: 3 });
  });

  it('reports the first line after a deletion', () => {
    const events = clone(buildLedger());
    events.splice(1, 1);
    expect(verifyChain(events)).toEqual({ ok: false, seq: 3 });
  });

  it('reports the first line of a swap', () => {
    const events = clone(buildLedger());
    const third = events[2];
    const fourth = events[3];
    if (!third || !fourth) throw new Error('fixture');
    events[2] = fourth;
    events[3] = third;
    expect(verifyChain(events)).toEqual({ ok: false, seq: 4 });
  });

  it('reports the duplicated seq of an insertion', () => {
    const events = clone(buildLedger());
    const second = events[1];
    if (!second) throw new Error('fixture');
    events.splice(2, 0, { ...second });
    expect(verifyChain(events)).toEqual({ ok: false, seq: 2 });
  });

  it('reports the line number of unparseable JSONL', () => {
    const lines = buildLedger().map((event) => JSON.stringify(event));
    lines[3] = '{ not json';
    expect(verifyChain(lines.join('\n'))).toEqual({ ok: false, seq: 4 });
  });

  it('replays to the projection the UI reads', () => {
    const projection = replay(buildLedger());
    expect(projection.epoch).toBe('ep_1');
    expect(projection.byItem.in_02).toBe('intent_1');
    expect(projection.intents.intent_1?.state).toBe('proven');
    expect(projection.intents.intent_1?.receipt?.transactionId).toBe('TX1');
    expect(projection.totals).toEqual({
      proven: { count: 1, amount: 135000 },
      awaitingProof: { count: 0, amount: 0 },
      held: { count: 0, amount: 0 },
      stopped: { count: 0, amount: 0 },
    });
  });
});
