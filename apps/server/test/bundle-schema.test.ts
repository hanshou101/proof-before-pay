// The validator behind AC-15 has to reject broken bundles, not just accept good ones.

import { describe, expect, it } from 'vitest';
import { bundleSchema } from '../src/bundle.js';
import { validateSchema } from '../src/json-schema.js';

const SHA = 'a'.repeat(64);

function validBundle(): Record<string, any> {
  return {
    bundleVersion: 'proof-bundle/1',
    intentId: 'int_in_02',
    itemId: 'in_02',
    generatedAt: '2026-11-06T17:30:05.000Z',
    source: {
      fileName: 'kenji-INV-0153.pdf',
      sha256: SHA,
      from: 'Kenji Watanabe <kenji@kenjimotion.example>',
      subject: 'INV-0153 — logo animation',
      receivedAt: '2026-11-04T10:15:00Z',
      kind: 'attachment',
    },
    extraction: { model: 'test-golden', at: '2026-11-06T17:30:01.000Z' },
    claim: {
      itemId: 'in_02',
      vendorId: 'ven_kenji',
      vendorName: 'Kenji Watanabe',
      senderEmail: 'kenji@kenjimotion.example',
      invoiceNumber: 'INV-0153',
      issueDate: '2026-11-04',
      currency: 'USD',
      total: 135000,
      po: 'PO-1191',
      requestedPayee: 'kenji@kenjimotion.example',
      lines: [
        { description: 'Logo animation — 3 variants', quantity: 1, unit: 'item', unitPrice: 135000, amount: 135000 },
      ],
      sourceSha256: SHA,
      extractedBy: null,
    },
    agreement: {
      id: 'agr_kenji_12',
      vendorId: 'ven_kenji',
      po: 'PO-1191',
      scope: 'Logo animation — 3 variants',
      kind: 'fixed',
      currency: 'USD',
      fee: 135000,
      rate: null,
      capUnits: null,
      deliveryIds: ['del_kenji_12'],
    },
    amountRule: 'fixed fee: the invoice total must equal $1,350.00.',
    delivery: {
      id: 'del_kenji_12',
      title: 'Logo animation — 3 variants',
      submittedAt: '2026-11-03T08:30:00Z',
      acceptedAt: '2026-11-04T09:05:00Z',
      acceptedBy: 'Maya',
      evidence: 'Project board · task LL-219 · approved',
    },
    payee: {
      onFile: 'kenji@kenjimotion.example',
      requested: 'kenji@kenjimotion.example',
      verifiedAt: '2025-11-20T15:00:00Z',
      method: 'video_call',
      verifiedBy: 'Maya',
      humanVerification: null,
    },
    checks: ['O1', 'O2', 'O3', 'O4', 'P1', 'P2', 'L1', 'L2', 'L3'].map((id) => ({
      id,
      status: 'pass',
      code: 'AMOUNT_MATCHES',
      facts: {},
    })),
    decision: 'approved',
    explanation: null,
    payment: {
      rail: 'paypal',
      amount: 135000,
      currency: 'USD',
      receiver: 'kenji@kenjimotion.example',
      senderBatchId: 'pbp-0123456789abcdef0123456789ab',
      payoutBatchId: 'BATCH-1',
      payoutItemId: 'ITEM-1',
      transactionId: 'TXN-1',
      railStatus: 'SUCCESS',
      fetchedAt: '2026-11-06T17:30:20.000Z',
      submittedAt: '2026-11-06T17:30:10.000Z',
      attempts: 1,
    },
    ledger: { seq: 42, hash: 'b'.repeat(64), eventType: 'receipt.updated', head: 44, verified: true },
  };
}

describe('proof-bundle.schema.json', () => {
  it('accepts a complete bundle', () => {
    expect(validateSchema(validBundle(), bundleSchema())).toEqual([]);
  });

  it('is JSON Schema 2020-12 and names every field AC-15 asks for', () => {
    const schema = bundleSchema() as Record<string, any>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    const required = schema.required as string[];
    for (const field of [
      'source',
      'extraction',
      'claim',
      'agreement',
      'amountRule',
      'delivery',
      'payee',
      'checks',
      'payment',
      'ledger',
    ]) {
      expect(required).toContain(field);
    }
  });

  it('rejects a bundle with no PayPal transaction id', () => {
    const bundle = validBundle();
    delete bundle.payment.transactionId;
    const errors = validateSchema(bundle, bundleSchema());
    expect(errors.some((error) => error.path === '$.payment.transactionId')).toBe(true);
  });

  it('rejects a file hash that is not a sha256', () => {
    const bundle = validBundle();
    bundle.source.sha256 = 'not-a-hash';
    expect(validateSchema(bundle, bundleSchema()).length).toBeGreaterThan(0);
  });

  it('rejects fewer than nine checks', () => {
    const bundle = validBundle();
    bundle.checks = bundle.checks.slice(0, 8);
    expect(validateSchema(bundle, bundleSchema()).length).toBeGreaterThan(0);
  });

  it('rejects an unknown check id and a missing decision', () => {
    const bundle = validBundle();
    bundle.checks[0].id = 'X1';
    delete bundle.decision;
    const errors = validateSchema(bundle, bundleSchema());
    expect(errors.some((error) => error.path.startsWith('$.checks[0].id'))).toBe(true);
    expect(errors.some((error) => error.path === '$.decision')).toBe(true);
  });

  it('rejects a ledger hash that is not a sha256', () => {
    const bundle = validBundle();
    bundle.ledger.hash = '0';
    expect(validateSchema(bundle, bundleSchema()).length).toBeGreaterThan(0);
  });
});
