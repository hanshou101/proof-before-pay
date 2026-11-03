// AC-2 — idempotency and "never pay twice".
//
// (a) the key is a deterministic function of (epoch, fingerprint): a *separate process*
//     computes it and must agree; 32 chars of [a-z0-9-].
// (b) a second proposal with the same fingerprint is `fail:DUPLICATE` while the original is
//     live, and is allowed again once the original is rejected / failed / cancelled.
// (c) the four ways of writing INV-0142 (including U+2011) fingerprint identically.

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { evaluate, fingerprint, idempotencyKey, normalizeInvoiceNumber } from '../src/index.ts';
import type { GateContext, IntentRecord, IntentState } from '../src/index.ts';
import { baseContext, EPOCH, proposalOf } from './fixtures.ts';

const DIST_URL = new URL('../dist/index.js', import.meta.url).href;

function fingerprintOf(itemId: string, overrides: Record<string, unknown> = {}) {
  const proposal = proposalOf(itemId, overrides);
  return fingerprint({
    vendorId: proposal.claim.vendorId ?? 'unknown',
    invoiceNumber: proposal.claim.invoiceNumber,
    currency: proposal.claim.currency,
    total: proposal.claim.total,
  });
}

function intentWith(state: IntentState, fp: string): IntentRecord {
  return {
    id: `intent_${state}`,
    itemId: 'in_02',
    vendorId: 'ven_kenji',
    agreementId: 'agr_kenji_12',
    amount: 135000,
    currency: 'USD',
    payee: { rail: 'paypal', recipientType: 'EMAIL', receiver: 'kenji@kenjimotion.example' },
    fingerprint: fp,
    idempotencyKey: idempotencyKey(EPOCH, fp),
    state,
    at: '2026-11-06T09:00:00Z',
  };
}

function contextWith(intents: IntentRecord[]): GateContext {
  const context = baseContext();
  context.intents = [context.intents[0] as IntentRecord, ...intents];
  return context;
}

describe('AC-2(a) idempotency key', () => {
  const fp = fingerprintOf('in_02');
  const key = idempotencyKey(EPOCH, fp);

  it('is 32 characters of [a-z0-9-]', () => {
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[a-z0-9-]+$/);
    expect(key.startsWith('pbp-')).toBe(true);
  });

  it('is the same key in a separate process', () => {
    const script = `
      import { fingerprint, idempotencyKey } from ${JSON.stringify(DIST_URL)};
      const input = JSON.parse(process.env.PBP_CHILD_INPUT);
      process.stdout.write(idempotencyKey(input.epoch, fingerprint(input.input)));
    `;
    const input = {
      epoch: EPOCH,
      input: {
        vendorId: 'ven_kenji',
        invoiceNumber: 'INV-0153',
        currency: 'USD',
        total: 135000,
      },
    };
    const child = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, PBP_CHILD_INPUT: JSON.stringify(input) },
      encoding: 'utf8',
    });
    expect(child.trim()).toBe(key);
  });

  it('changes when the epoch changes and when the invoice changes', () => {
    expect(idempotencyKey('ep_other', fp)).not.toBe(key);
    expect(idempotencyKey(EPOCH, fingerprintOf('in_08'))).not.toBe(key);
  });
});

describe('AC-2(b) duplicate detection', () => {
  it('is not a duplicate on a clean run', () => {
    const { checks } = evaluate(proposalOf('in_02'), baseContext());
    expect(checks.find((check) => check.id === 'O4')?.status).toBe('pass');
  });

  it('is fail:DUPLICATE while the original is live', () => {
    for (const state of ['approved', 'submitted', 'awaiting', 'proven'] as const) {
      const { checks, decision } = evaluate(
        proposalOf('in_02'),
        contextWith([intentWith(state, fingerprintOf('in_02'))]),
      );
      const o4 = checks.find((check) => check.id === 'O4');
      expect(o4?.status, `original ${state}`).toBe('fail');
      expect(o4?.code).toBe('DUPLICATE');
      expect(o4?.facts.duplicateOf).toBe(`intent_${state}`);
      expect(o4?.facts.originalState).toBe(state);
      expect(decision).toBe('blocked');
    }
  });

  it('is allowed again when the original is rejected / failed / cancelled', () => {
    for (const state of ['rejected', 'failed', 'cancelled'] as const) {
      const { checks } = evaluate(
        proposalOf('in_02'),
        contextWith([intentWith(state, fingerprintOf('in_02'))]),
      );
      const o4 = checks.find((check) => check.id === 'O4');
      expect(o4?.status, `original ${state}`).toBe('pass');
      expect(o4?.code).toBe('NOT_DUPLICATE');
    }
  });
});

describe('AC-2(c) invoice number normalisation', () => {
  const spellings = ['INV-0142', 'inv 0142', 'INV-142', 'INV\u20110142'];

  it('normalises all four spellings to INV142', () => {
    for (const spelling of spellings) {
      expect(normalizeInvoiceNumber(spelling), JSON.stringify(spelling)).toBe('INV142');
    }
  });

  it('gives all four spellings the same fingerprint', () => {
    const prints = spellings.map((invoiceNumber) =>
      fingerprint({ vendorId: 'ven_kenji', invoiceNumber, currency: 'USD', total: 115000 }),
    );
    expect(new Set(prints).size).toBe(1);
  });

  it('strips leading zeros in the numeric field only', () => {
    expect(normalizeInvoiceNumber('INV-2026-118')).toBe('INV2026118');
    expect(normalizeInvoiceNumber('INV-001')).toBe('INV1');
    expect(normalizeInvoiceNumber('1009')).toBe('1009');
    expect(normalizeInvoiceNumber('000')).toBe('0');
  });
});
