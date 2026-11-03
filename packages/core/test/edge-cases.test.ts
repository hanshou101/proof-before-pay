// Edge cases the ticket names explicitly, plus the money/normalisation units.
//
//   - L1 / L2 / L3 exactly at the limit pass, one cent over holds
//   - O2 hourly and per_word unit-price drift is AMOUNT_MISMATCH
//   - O1 unknown vendor → UNKNOWN_VENDOR and O2–O3, P1–P2, L3 are `na`
//   - a human lowering to the contract cap and accepting delivery turns in_05 approved

import { describe, expect, it } from 'vitest';
import { evaluate, formatUSD, normalizeInvoiceNumber, sealOf } from '../src/index.ts';
import type { CheckResult, GateContext, IntentRecord } from '../src/index.ts';
import { baseContext, proposalOf } from './fixtures.ts';

function checksById(checks: readonly CheckResult[]): Record<string, CheckResult> {
  return Object.fromEntries(checks.map((check) => [check.id, check]));
}

/** An intent booked today, so L2 sees it. */
function bookedToday(amount: number): IntentRecord {
  return {
    id: `intent_today_${amount}`,
    itemId: 'in_history',
    vendorId: 'ven_priya',
    agreementId: 'agr_priya_03',
    amount,
    currency: 'USD',
    payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'priya@nairwords.example' },
    fingerprint: `fp_${amount}`,
    idempotencyKey: `pbp-today-${amount}`,
    state: 'proven',
    at: '2026-11-06T08:00:00Z',
  };
}

describe('L1 per-payment limit', () => {
  it('passes exactly at the limit and holds one cent over', () => {
    const context = baseContext();
    const agreement = context.agreements.find((entry) => entry.id === 'agr_priya_03');
    if (!agreement) throw new Error('missing agreement');
    agreement.fee = 250000;

    const atLimit = evaluate(proposalOf('in_01', { total: 250000 }), context);
    expect(checksById(atLimit.checks).L1?.status).toBe('pass');
    expect(checksById(atLimit.checks).L1?.facts).toMatchObject({ amount: 250000, limit: 250000 });

    const context2 = baseContext();
    const agreement2 = context2.agreements.find((entry) => entry.id === 'agr_priya_03');
    if (!agreement2) throw new Error('missing agreement');
    agreement2.fee = 250001;
    const over = evaluate(proposalOf('in_01', { total: 250001 }), context2);
    expect(checksById(over.checks).L1?.status).toBe('hold');
    expect(checksById(over.checks).L1?.code).toBe('OVER_LIMIT');
    expect(over.decision).toBe('held');
  });
});

describe('L2 daily limit', () => {
  function runWithBooked(booked: number) {
    const context: GateContext = baseContext();
    context.intents = [...context.intents, bookedToday(booked)];
    return evaluate(proposalOf('in_08'), context);
  }

  it('passes exactly at the limit and holds one cent over', () => {
    // in_08 bills 180000; dailyLimit is 1000000.
    const atLimit = runWithBooked(820000);
    expect(checksById(atLimit.checks).L2?.status).toBe('pass');
    expect(checksById(atLimit.checks).L2?.facts.todayTotal).toBe(820000);

    const over = runWithBooked(820001);
    expect(checksById(over.checks).L2?.status).toBe('hold');
    expect(checksById(over.checks).L2?.code).toBe('OVER_DAILY_LIMIT');
  });

  it('ignores intents from another UTC day', () => {
    const context = baseContext();
    const stale = bookedToday(990000);
    context.intents = [...context.intents, { ...stale, at: '2026-11-05T23:59:59Z' }];
    const result = evaluate(proposalOf('in_08'), context);
    expect(checksById(result.checks).L2?.status).toBe('pass');
    expect(checksById(result.checks).L2?.facts.todayTotal).toBe(0);
  });
});

describe('L3 new-vendor limit', () => {
  function runWithFee(fee: number) {
    const context = baseContext();
    const agreement = context.agreements.find((entry) => entry.id === 'agr_jonas_01');
    if (!agreement) throw new Error('missing agreement');
    agreement.fee = fee;
    return evaluate(proposalOf('in_07', { total: fee }), context);
  }

  it('passes exactly at the new-vendor limit and holds one cent over', () => {
    const atLimit = runWithFee(100000);
    expect(checksById(atLimit.checks).L3?.status).toBe('pass');
    expect(checksById(atLimit.checks).L3?.code).toBe('NEW_VENDOR_WITHIN_LIMIT');
    expect(checksById(atLimit.checks).L3?.facts).toMatchObject({ priorPayments: 0, amount: 100000, limit: 100000 });

    const over = runWithFee(100001);
    expect(checksById(over.checks).L3?.status).toBe('hold');
    expect(checksById(over.checks).L3?.code).toBe('NEW_VENDOR_OVER_LIMIT');
    expect(over.decision).toBe('held');
  });

  it('marks an established vendor instead of checking the cap', () => {
    const result = evaluate(proposalOf('in_01'), baseContext());
    expect(checksById(result.checks).L3?.code).toBe('VENDOR_ESTABLISHED');
    expect(checksById(result.checks).L3?.facts.priorPayments).toBe(9);
  });
});

describe('O2 unit-price drift', () => {
  it('holds in_05 when the hourly rate does not match the contract', () => {
    const proposal = proposalOf('in_05', {
      lines: [{ description: 'Hero animation v2 — modelling & animation', quantity: 40, unit: 'hour', unitPrice: 6100, amount: 244000 }],
      total: 244000,
    });
    const result = evaluate(proposal, baseContext());
    expect(checksById(result.checks).O2?.status).toBe('hold');
    expect(checksById(result.checks).O2?.code).toBe('AMOUNT_MISMATCH');
  });

  it('holds in_06 when the per-word rate does not match the contract', () => {
    const proposal = proposalOf('in_06', {
      lines: [
        {
          description: 'Translation of the Lumen & Lark brand guidelines, Italian → English',
          quantity: 8200,
          unit: 'word',
          unitPrice: 10,
          amount: 82000,
        },
      ],
      total: 82000,
    });
    const result = evaluate(proposal, baseContext());
    expect(checksById(result.checks).O2?.status).toBe('hold');
    expect(checksById(result.checks).O2?.code).toBe('AMOUNT_MISMATCH');
  });

  it('holds when the line amounts do not add up to the total', () => {
    const proposal = proposalOf('in_05', { total: 240001 });
    const result = evaluate(proposal, baseContext());
    expect(checksById(result.checks).O2?.code).toBe('AMOUNT_MISMATCH');
  });
});

describe('O1 unknown vendor', () => {
  it('holds with UNKNOWN_VENDOR and n/a for the dependent checks', () => {
    const proposal = proposalOf('in_01', {
      senderEmail: 'stranger@somewhere.example',
      vendorName: 'Nobody Ltd',
      po: null,
      vendorId: null,
    });
    const { checks, decision } = evaluate(proposal, baseContext());
    const byId = checksById(checks);

    expect(byId.O1?.status).toBe('hold');
    expect(byId.O1?.code).toBe('UNKNOWN_VENDOR');
    expect(byId.O1?.facts).toMatchObject({ vendorId: null, matchedBy: null });

    for (const id of ['O2', 'O3', 'P1', 'P2', 'L3']) {
      expect(byId[id]?.status, id).toBe('na');
    }
    expect(byId.L1?.status).toBe('pass');
    expect(byId.L2?.status).toBe('pass');
    expect(decision).toBe('held');
  });

  it('ignores a vendor id the LLM made up and follows the sender instead', () => {
    const proposal = proposalOf('in_02', { vendorId: 'ven_priya' });
    const { checks } = evaluate(proposal, baseContext());
    const o1 = checksById(checks).O1;
    expect(o1?.facts.vendorId).toBe('ven_kenji');
    expect(o1?.facts.matchedBy).toBe('sender');
    expect(o1?.facts.claimedVendorId).toBe('ven_priya');
  });
});

describe('human approval at the contract cap', () => {
  it('turns in_05 approved after the delivery is accepted and the amount lowered', () => {
    const context = baseContext();
    const delivery = context.deliveries.find((entry) => entry.id === 'del_leo_02');
    if (!delivery) throw new Error('missing delivery');
    delivery.acceptedAt = '2026-11-06T09:05:00Z';
    delivery.acceptedBy = 'Maya';
    context.approvedAmount = 192000;
    context.approvedBy = 'Maya';

    const { checks, decision } = evaluate(proposalOf('in_05'), context);
    const byId = checksById(checks);

    expect(byId.O2?.status).toBe('pass');
    expect(byId.O2?.code).toBe('AMOUNT_MATCHES');
    expect(byId.O2?.facts.approvedBy).toBe('Maya');
    expect(byId.O3?.status).toBe('pass');
    expect(byId.L1?.facts.amount).toBe(192000);
    expect(decision).toBe('approved');
  });

  it('still holds if the lowered amount is above the cap', () => {
    const context = baseContext();
    const delivery = context.deliveries.find((entry) => entry.id === 'del_leo_02');
    if (!delivery) throw new Error('missing delivery');
    delivery.acceptedAt = '2026-11-06T09:05:00Z';
    context.approvedAmount = 200000;

    const result = evaluate(proposalOf('in_05'), context);
    expect(checksById(result.checks).O2?.code).toBe('OVER_CAP');
    expect(result.decision).toBe('held');
  });
});

describe('seals', () => {
  it('reports the worst status of each group', () => {
    const { checks } = evaluate(proposalOf('in_05'), baseContext());
    expect(sealOf(checks, 'owed')).toBe('hold');
    expect(sealOf(checks, 'payee')).toBe('pass');
    expect(sealOf(checks, 'policy')).toBe('pass');

    const blocked = evaluate(proposalOf('in_03'), baseContext());
    expect(sealOf(blocked.checks, 'owed')).toBe('fail');
  });
});

describe('money', () => {
  it('formats integer cents as USD', () => {
    expect(formatUSD(135000)).toBe('$1,350.00');
    expect(formatUSD(0)).toBe('$0.00');
    expect(formatUSD(5)).toBe('$0.05');
    expect(formatUSD(123456789)).toBe('$1,234,567.89');
    expect(formatUSD(-240000)).toBe('-$2,400.00');
  });

  it('refuses non-integer cents', () => {
    expect(() => formatUSD(1350.5)).toThrow(RangeError);
    expect(() => formatUSD(Number.NaN)).toThrow(RangeError);
  });
});

describe('invoice number normalisation', () => {
  it('handles every hyphen the SPEC lists', () => {
    for (const hyphen of ['\u002D', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212']) {
      expect(normalizeInvoiceNumber(`INV${hyphen}0142`)).toBe('INV142');
    }
  });
});

describe('epoch', () => {
  it('does not change the checks — only the idempotency key', () => {
    const base = baseContext();
    const other: GateContext = { ...base, epoch: 'ep_other' };
    const a = evaluate(proposalOf('in_01'), base);
    const b = evaluate(proposalOf('in_01'), other);
    expect(a.decision).toBe(b.decision);
    expect(JSON.stringify(a.checks)).toBe(JSON.stringify(b.checks));
  });
});
