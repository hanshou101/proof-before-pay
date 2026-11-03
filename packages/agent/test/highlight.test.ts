// Step 7 (SPEC v1.4 §6.6.2): the highlight is a headline, not a debug line.
//
// The totals line is code, the highlight is the model's one sentence, and both must stay free of
// internal record ids. The template is checked too, because it is what the header shows when the
// model's sentence is rejected.

import { describe, expect, it } from 'vitest';
import { checkHighlight, summarize, templateHighlight, totalsLine } from '../src/highlight.js';
import { internalIdsIn } from '../src/explain.js';
import type { SummarizableIntent, Totals } from '../src/types.js';
import { ScriptedModel } from './helpers.js';

const TOTALS: Totals = {
  proven: { count: 4, amount: 508800 },
  awaitingProof: { count: 1, amount: 64000 },
  held: { count: 2, amount: 480000 },
  stopped: { count: 1, amount: 115000 },
  ignored: { count: 1 },
};

const INTENTS: SummarizableIntent[] = [
  {
    intentId: 'int_in_03',
    itemId: 'in_03',
    vendorName: 'Kenji Watanabe',
    invoiceNumber: 'INV-0142',
    amount: 115000,
    decision: 'blocked',
    checks: [
      { id: 'O4', status: 'fail', code: 'DUPLICATE', facts: { duplicateOf: 'hist_kenji_0142', transactionId: 'FIXTURE-TXN-0142' } },
    ],
  },
  {
    intentId: 'int_in_04',
    itemId: 'in_04',
    vendorName: 'Ana Ribeiro',
    invoiceNumber: 'INV-2207',
    amount: 240000,
    decision: 'held',
    checks: [
      { id: 'P1', status: 'hold', code: 'PAYEE_MISMATCH', facts: { onFile: 'ana@studionorth.example' } },
      { id: 'P2', status: 'hold', code: 'CHANGE_REQUEST_PENDING', facts: { requestId: 'cr_in_04' } },
    ],
  },
  {
    intentId: 'int_in_05',
    itemId: 'in_05',
    vendorName: 'Leo Martin',
    invoiceNumber: 'INV-031',
    amount: 240000,
    decision: 'held',
    checks: [{ id: 'O3', status: 'hold', code: 'NOT_ACCEPTED', facts: { deliveryId: 'del_leo_02' } }],
  },
];

describe('totalsLine', () => {
  it('is code-generated, to the cent', () => {
    expect(totalsLine(TOTALS)).toBe(
      '4 proven by PayPal ($5,088.00) · 1 awaiting proof ($640.00) · 2 held for review ($4,800.00) · 1 stopped ($1,150.00) · 1 not invoices.',
    );
  });
});

describe('templateHighlight', () => {
  it('names what needs a human without any internal id', () => {
    const text = templateHighlight(TOTALS, INTENTS);
    expect(text).toBe('2 held and 1 stopped — starting with INV-0142, none of them moves without a human.');
    expect(internalIdsIn(text)).toEqual([]);
    expect(checkHighlight(text, INTENTS).ok).toBe(true);
  });
});

describe('checkHighlight', () => {
  it('accepts a sentence that names a held invoice', () => {
    expect(checkHighlight('INV-2207 from Studio North still needs a human before it moves.', INTENTS).ok).toBe(true);
  });

  it('rejects a highlight with an internal record id', () => {
    const check = checkHighlight('The change request cr_in_04 for INV-2207 still needs a human.', INTENTS);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('cr_in_04');
  });

  it('rejects a highlight that claims everything was paid', () => {
    expect(checkHighlight('All invoices were paid after a clean run.', INTENTS).ok).toBe(false);
  });

  it('rejects a highlight that names no held or stopped invoice', () => {
    expect(checkHighlight('Two payments still need a human before they move.', INTENTS).ok).toBe(false);
  });
});

describe('summarize', () => {
  it('keeps a valid model sentence as model', async () => {
    const model = new ScriptedModel([
      { content: JSON.stringify({ highlight: 'INV-2207 is held for a payee change that no one has verified yet.' }) },
    ]);
    const summary = await summarize(TOTALS, INTENTS, { model });
    expect(summary.highlight.source).toBe('model');
    expect(summary.highlight.text).toContain('INV-2207');
  });

  it('sends an internal id back once, then uses the template', async () => {
    const bad = JSON.stringify({ highlight: 'The change request cr_in_04 for INV-2207 is still pending.' });
    const model = new ScriptedModel([{ content: bad }, { content: bad }]);
    const summary = await summarize(TOTALS, INTENTS, { model });

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.user).toContain('cr_in_04');
    expect(summary.highlight.source).toBe('template');
    expect(summary.highlight.text).toBe(templateHighlight(TOTALS, INTENTS));
    expect(internalIdsIn(summary.highlight.text)).toEqual([]);
  });
});
