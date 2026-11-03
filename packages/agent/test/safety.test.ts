// AC-9c — the safe-mode agent cannot move money.
//
// The claim is architectural, so the test asserts it in three ways:
//   1. the tool list handed to the model is empty and frozen;
//   2. `processItem` has no sender parameter and ignores one smuggled into its context;
//   3. the only payout code path, `runComparison`, refuses to run without an injected sender.

import { describe, expect, it, vi } from 'vitest';
import { SAFE_MODE_TOOLS, processItem, runComparison } from '../src/index.js';
import { demo, item, ScriptedModel } from './helpers.js';

const EXTRACTION = {
  classification: 'invoice',
  claim: {
    vendorName: 'Studio North',
    invoiceNumber: 'INV-2207',
    issueDate: '2026-11-04',
    currency: 'USD',
    total: '2,400.00',
    po: null,
    requestedPayee: null,
    lines: [{ description: 'Illustrations', quantity: 1, unit: 'item', unitPrice: '2,400.00', amount: '2,400.00' }],
    source: { kind: 'attachment', name: 'invoice.pdf' },
  },
  changeRequest: null,
  notes: [],
};

// extract → risk note → agreement match (the synthetic item has no PO).
const script = () => [
  { content: JSON.stringify(EXTRACTION) },
  { content: '{"note":"The sender domain imitates a known domain."}' },
  { content: '{"agreementId":"agr_ana_07","reason":"Only agreement on file for this vendor."}' },
];

describe('AC-9c — safe mode holds no paying capability', () => {
  it('gives the model an empty, frozen tool list', () => {
    expect(SAFE_MODE_TOOLS).toEqual([]);
    expect(Object.isFrozen(SAFE_MODE_TOOLS)).toBe(true);
  });

  it('never hands the model a tool during processItem', async () => {
    const model = new ScriptedModel(script());
    await processItem(item(), {
      vendors: demo.vendors,
      agreements: demo.agreements,
      payerDomain: demo.payer.domain,
      model,
    });

    expect(model.requests.length).toBeGreaterThan(0);
    for (const request of model.requests) {
      expect(request.tools ?? []).toEqual([]);
    }
  });

  it('ignores a sender smuggled into the context', async () => {
    const sender = vi.fn(async () => ({ senderBatchId: 'x', payoutBatchId: 'y' }));
    const model = new ScriptedModel(script());

    const result = await processItem(item(), {
      vendors: demo.vendors,
      agreements: demo.agreements,
      payerDomain: demo.payer.domain,
      model,
      // Deliberately not part of AgentContext: processItem must not look for it.
      sender,
    } as unknown as Parameters<typeof processItem>[1]);

    expect(sender).not.toHaveBeenCalled();
    expect(result.claim?.total).toBe(240000);
  });

  it('returns a result with no payout, sender or rail field', async () => {
    const model = new ScriptedModel(script());
    const result = await processItem(item(), {
      vendors: demo.vendors,
      agreements: demo.agreements,
      payerDomain: demo.payer.domain,
      model,
    });

    const keys = Object.keys(result);
    for (const forbidden of ['payout', 'sender', 'rail', 'receipt', 'transactionId']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(result.proposal).not.toBeNull();
  });

  it('takes no sender argument at all', () => {
    // processItem(item, ctx) — a third parameter would be a place to pass a rail.
    expect(processItem.length).toBe(2);
  });

  it('refuses to run the comparison agent without an injected sender', async () => {
    const model = new ScriptedModel([
      { toolCalls: [{ id: 'c1', name: 'send_paypal_payout', arguments: '{"receiver_email":"a@b.example","amount_usd":1}' }] },
    ]);
    await expect(
      runComparison([item()], undefined as unknown as Parameters<typeof runComparison>[1], model),
    ).rejects.toThrow();
  });
});
