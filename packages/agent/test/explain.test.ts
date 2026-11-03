// Step 6 (AC-10, SPEC v1.4): an explanation is only accepted when it carries the decisive fact
// for the check that stopped the payment, attributes "unverified" to the right address, and
// names no internal record id. The deterministic template must satisfy the same fact check,
// because it is what the reader sees when the model's sentence is rejected twice.
//
// The three in_04 sentences below are verbatim from the first round's real run
// (`proof/ai/explain-run-{1,2,3}/summary.json` before this round's re-run). They are the
// examples the reviewer called out: run 1 called the *on-file* address unverified, and all
// three carried `cr_in_04`.

import { describe, expect, it } from 'vitest';
import type { CheckResult, Claim } from '@pbp/core';
import {
  checkFacts,
  callsPayeeOnFileUnverified,
  explainIntent,
  internalIdsIn,
  templateExplanation,
} from '../src/explain.js';
import type { ExplainInput } from '../src/types.js';
import { ScriptedModel } from './helpers.js';

const ON_FILE = 'ana@studionorth.example';
const REQUESTED = 'billing@studi0-north.example';

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    itemId: 'in_03',
    vendorId: 'ven_kenji',
    vendorName: 'Kenji Watanabe',
    senderEmail: 'kenji@kenjimotion.example',
    invoiceNumber: 'INV-0142',
    issueDate: '2026-10-28',
    currency: 'USD',
    total: 115000,
    po: 'PO-1176',
    requestedPayee: null,
    lines: [{ description: 'Motion graphics', quantity: 1, unit: 'item', unitPrice: 115000, amount: 115000 }],
    sourceSha256: 'c'.repeat(64),
    extractedBy: null,
    ...overrides,
  };
}

function input(overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    intentId: 'int_in_03',
    itemId: 'in_03',
    decision: 'blocked',
    claim: claim(),
    checks: [],
    original: null,
    ...overrides,
  };
}

const DUPLICATE: CheckResult = {
  id: 'O4',
  status: 'fail',
  code: 'DUPLICATE',
  facts: { duplicateOf: 'hist_kenji_0142', originalState: 'proven', transactionId: null },
};
const PAYEE: CheckResult = {
  id: 'P1',
  status: 'hold',
  code: 'PAYEE_MISMATCH',
  facts: { onFile: ON_FILE, requested: REQUESTED, verifiedAt: '2026-03-02T17:00:00Z', method: 'video_call' },
};
const CHANGE_REQUEST: CheckResult = {
  id: 'P2',
  status: 'hold',
  code: 'CHANGE_REQUEST_PENDING',
  facts: { requestId: 'cr_in_04', requestedAt: '2026-11-04T21:47:00Z', sourceItemId: 'in_04', requestedPayee: REQUESTED },
};
const OVER_CAP: CheckResult = { id: 'O2', status: 'hold', code: 'OVER_CAP', facts: { billedUnits: 40, capUnits: 32 } };
const NOT_ACCEPTED: CheckResult = {
  id: 'O3',
  status: 'hold',
  code: 'NOT_ACCEPTED',
  facts: { deliveryId: 'del_leo_02', submittedAt: '2026-11-01T09:00:00Z', acceptedAt: null },
};

const PAID_AT = '2026-11-06T17:30:00Z';
const ORIGINAL = { id: 'hist_kenji_0142', transactionId: 'FIXTURE-TXN-0142', paidAt: PAID_AT };

function payeeInput(): ExplainInput {
  return input({
    itemId: 'in_04',
    decision: 'held',
    checks: [PAYEE, CHANGE_REQUEST],
    claim: claim({ itemId: 'in_04', vendorId: 'ven_ana', invoiceNumber: 'INV-2207', requestedPayee: REQUESTED }),
  });
}

/** Only the "unverified payee attribution" defect, so the id rule cannot hide it. */
function payeeAttributionProblems(text: string): string[] {
  return checkFacts(text, payeeInput()).problems.filter((problem) => problem.includes('calls the payee on file'));
}

describe('checkFacts — DUPLICATE (SPEC v1.4: the payment, not the paperwork)', () => {
  it('rejects a sentence that only has the original invoice’s issue date', () => {
    const target = input({ checks: [DUPLICATE], original: { id: 'hist_kenji_0142', transactionId: null, paidAt: null } });
    const facts = checkFacts('INV-0142 duplicates an invoice issued on 2026-10-28.', target);
    expect(facts.ok).toBe(false);
    expect(facts.missing).toContain('the original payment’s transaction id or payment date');
  });

  it('accepts the original payment’s transaction id', () => {
    const target = input({ checks: [DUPLICATE], original: ORIGINAL });
    expect(checkFacts('INV-0142 duplicates PayPal transaction FIXTURE-TXN-0142.', target).ok).toBe(true);
  });

  it('accepts the original payment’s date, written the way a person writes it', () => {
    const target = input({ checks: [DUPLICATE], original: ORIGINAL });
    expect(checkFacts('INV-0142 was already paid on 6 November 2026.', target).ok).toBe(true);
    expect(checkFacts('INV-0142 was already paid on 2026-11-06.', target).ok).toBe(true);
  });

  it('takes the transaction id from the gate’s own facts when the caller does not repeat it', () => {
    const target = input({
      checks: [{ ...DUPLICATE, facts: { ...DUPLICATE.facts, transactionId: 'PAY-88213' } }],
      original: { id: 'hist_kenji_0142', transactionId: null, paidAt: null },
    });
    expect(checkFacts('INV-0142 duplicates PayPal transaction PAY-88213.', target).ok).toBe(true);
  });

  it('does not accept "not recorded" as a fact', () => {
    const target = input({ checks: [DUPLICATE], original: { id: 'hist_kenji_0142', transactionId: null, paidAt: null } });
    expect(checkFacts('INV-0142 duplicates a payment whose date was not recorded.', target).ok).toBe(false);
  });
});

describe('checkFacts — PAYEE_MISMATCH attribution (SPEC v1.4)', () => {
  const run1 =
    'The invoice is held because the payee email billing@studi0-north.example does not match the unverified email ana@studionorth.example on file, and a change request (cr_in_04) to that payee is still pending. A human must verify the correct payee and resolve the pending change request before this can be paid.';
  const run2 =
    'The invoice lists billing@studi0-north.example as payee while the payee on file is ana@studionorth.example, and that requested payee is unverified, so a human must confirm the correct payee before this can be paid. A change request (cr_in_04) to that same unverified address is also pending, which a human must review.';
  const run3 =
    'The payment is held because the payee email on file is ana@studionorth.example while the invoice requests billing@studi0-north.example, and that requested address is unverified. A human must check the pending change request cr_in_04, which asks for the payee to be changed to billing@studi0-north.example.';

  it('rejects round 1’s sentence: it hangs "unverified" on the payee on file', () => {
    const problems = payeeAttributionProblems(run1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`calls the payee on file ${ON_FILE} unverified`);
    expect(callsPayeeOnFileUnverified(run1, ON_FILE)).toBe(true);
  });

  it('accepts round 2’s sentence: the negation is attached to the requested address', () => {
    expect(payeeAttributionProblems(run2)).toEqual([]);
    expect(callsPayeeOnFileUnverified(run2, ON_FILE)).toBe(false);
    // Its only defect is the internal id (item 4 of the ruling), not the payee attribution.
    expect(checkFacts(run2, payeeInput()).problems.some((problem) => problem.includes('internal record ids'))).toBe(true);
  });

  it('accepts round 3’s sentence: same rule, different word order', () => {
    expect(payeeAttributionProblems(run3)).toEqual([]);
    expect(callsPayeeOnFileUnverified(run3, ON_FILE)).toBe(false);
  });

  it('accepts a clean two-address sentence', () => {
    const clean = `The invoice asks for ${REQUESTED}, but the verified payee on file is ${ON_FILE}, and the change is unverified. A human must verify it with the vendor before paying.`;
    expect(checkFacts(clean, payeeInput()).ok).toBe(true);
  });
});

describe('checkFacts — internal record ids (SPEC v1.4 §6.6.2 steps 6–7)', () => {
  it('finds cr_ / del_ / hist_ / agr_ / ven_ / int_ / in_ ids', () => {
    expect(internalIdsIn('the request cr_in_04 and delivery del_leo_02')).toEqual(['cr_in_04', 'del_leo_02']);
    expect(internalIdsIn('the seeded payment hist_kenji_0142')).toEqual(['hist_kenji_0142']);
    expect(internalIdsIn('INV-0142 paid on 6 November 2026.')).toEqual([]);
  });

  it('rejects an otherwise correct explanation that names an id', () => {
    const target = input({ itemId: 'in_05', decision: 'held', checks: [OVER_CAP, NOT_ACCEPTED] });
    const withId =
      'The invoice bills 40 hours against a 32-hour cap, and the delivery del_leo_02 is not accepted. A human must decide what to pay.';
    const withoutId =
      'The invoice bills 40 hours against a 32-hour cap, and the delivery is not accepted. A human must decide what to pay.';

    expect(checkFacts(withId, target).ok).toBe(false);
    expect(checkFacts(withId, target).problems[0]).toContain('del_leo_02');
    expect(checkFacts(withoutId, target).ok).toBe(true);
  });

  it('rejects a payee sentence that names the change request id', () => {
    const text = `The invoice asks for ${REQUESTED} but the verified payee on file is ${ON_FILE}; the change request cr_in_04 is unverified. A human must verify it with the vendor.`;
    expect(checkFacts(text, payeeInput()).problems.join(' ')).toContain('cr_in_04');
  });
});

describe('checkFacts — OVER_CAP and NOT_ACCEPTED', () => {
  it('OVER_CAP needs both the billed units and the cap', () => {
    const cap = input({ itemId: 'in_05', decision: 'held', checks: [OVER_CAP], claim: claim({ itemId: 'in_05', invoiceNumber: 'INV-031' }) });
    expect(checkFacts('The invoice is over the contract cap.', cap).missing).toEqual(['the billed units 40', 'the cap 32']);
    expect(checkFacts('It bills 40 hours against a cap of 32.', cap).ok).toBe(true);
  });

  it('NOT_ACCEPTED needs the acceptance wording', () => {
    const acceptance = input({ itemId: 'in_05', decision: 'held', checks: [NOT_ACCEPTED] });
    expect(checkFacts('The delivery is outstanding.', acceptance).missing).toEqual(['"not accepted" or "in review"']);
    expect(checkFacts('The work is still in review.', acceptance).ok).toBe(true);
  });

  it('ignores checks that passed', () => {
    const passed = input({ checks: [{ ...DUPLICATE, status: 'pass' }], decision: 'approved' });
    expect(checkFacts('Nothing to explain.', passed).ok).toBe(true);
  });
});

describe('templateExplanation', () => {
  const cases: { name: string; input: ExplainInput }[] = [
    { name: 'duplicate with a transaction id', input: input({ checks: [DUPLICATE], original: ORIGINAL }) },
    {
      name: 'duplicate with a payment date only',
      input: input({ checks: [DUPLICATE], original: { id: 'hist_kenji_0142', transactionId: null, paidAt: PAID_AT } }),
    },
    { name: 'payee mismatch', input: payeeInput() },
    { name: 'over cap', input: input({ itemId: 'in_05', decision: 'held', checks: [OVER_CAP] }) },
    { name: 'not accepted', input: input({ itemId: 'in_05', decision: 'held', checks: [NOT_ACCEPTED] }) },
    {
      name: 'over cap and not accepted',
      input: input({ itemId: 'in_05', decision: 'held', checks: [OVER_CAP, NOT_ACCEPTED] }),
    },
    { name: 'nothing specific', input: input({ checks: [{ id: 'L1', status: 'hold', code: 'SOMETHING', facts: {} }] }) },
  ];

  for (const entry of cases) {
    it(`satisfies the same fact check as the model (${entry.name})`, () => {
      const text = templateExplanation(entry.input);
      const facts = checkFacts(text, entry.input);
      expect(facts.missing).toEqual([]);
      expect(facts.problems).toEqual([]);
      expect(text.split(/(?<=[.!?])\s+/).filter((part) => part.trim() !== '').length).toBeLessThanOrEqual(2);
      expect(internalIdsIn(text)).toEqual([]);
    });
  }

  it('names the original payment’s transaction id, never the invoice’s issue date', () => {
    const text = templateExplanation(input({ checks: [DUPLICATE], original: ORIGINAL }));
    expect(text).toContain('FIXTURE-TXN-0142');
    expect(text).not.toContain('2026-10-28');
  });
});

describe('explainIntent', () => {
  it('keeps a valid model sentence and labels it model', async () => {
    const model = new ScriptedModel([
      {
        content: JSON.stringify({
          text: `The invoice asks for ${REQUESTED}, but the verified payee on file is ${ON_FILE}, and the change is unverified. A human must verify it with the vendor before paying.`,
        }),
      },
    ]);
    const result = await explainIntent(payeeInput(), { model });
    expect(result.source).toBe('model');
    expect(result.attempts).toBe(1);
  });

  it('sends round 1’s sentence back once, then falls back to the template', async () => {
    const run1 = JSON.stringify({
      text: 'The invoice is held because the payee email billing@studi0-north.example does not match the unverified email ana@studionorth.example on file, and a change request (cr_in_04) to that payee is still pending. A human must verify the correct payee and resolve the pending change request before this can be paid.',
    });
    const model = new ScriptedModel([{ content: run1 }, { content: run1 }]);
    const target = payeeInput();
    const result = await explainIntent(target, { model });

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.user).toContain('did not pass validation');
    expect(model.requests[1]?.user).toContain('calls the payee on file');
    expect(result.source).toBe('template');
    expect(result.attempts).toBe(2);
    expect(result.text).toBe(templateExplanation(target));
  });

  it('falls back to the template with source template after two vague answers', async () => {
    const vague = JSON.stringify({ text: 'The payment is held. A human has to look at it.' });
    const model = new ScriptedModel([{ content: vague }, { content: vague }]);
    const target = input({ checks: [OVER_CAP], itemId: 'in_05', decision: 'held' });
    const result = await explainIntent(target, { model });

    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.user).toContain('did not pass validation');
    expect(result.source).toBe('template');
    expect(result.attempts).toBe(2);
    expect(result.text).toBe(templateExplanation(target));
    expect(result.rejectedFor).toContain('the billed units 40');
  });

  it('rejects a three-sentence answer even when the facts are present', async () => {
    const three = JSON.stringify({
      text: 'It bills 40 hours against a 32-hour cap. That is over the cap. A human must decide.',
    });
    const model = new ScriptedModel([{ content: three }, { content: three }]);
    const result = await explainIntent(input({ itemId: 'in_05', decision: 'held', checks: [OVER_CAP] }), { model });

    expect(model.requests[1]?.user).toContain('3 sentences');
    expect(result.source).toBe('template');
  });

  it('answers an approved intent without calling the model', async () => {
    const model = new ScriptedModel([]);
    const result = await explainIntent(input({ decision: 'approved', checks: [] }), { model });
    expect(result.source).toBe('template');
    expect(result.attempts).toBe(0);
    expect(model.requests).toHaveLength(0);
    expect(result.text).toContain('All nine checks passed');
  });

  it('never sends an internal record id to the model', async () => {
    const model = new ScriptedModel([
      {
        content: JSON.stringify({
          text: `The invoice asks for ${REQUESTED}, but the verified payee on file is ${ON_FILE}, and the change is unverified. A human must verify it with the vendor before paying.`,
        }),
      },
    ]);
    await explainIntent(payeeInput(), { model });

    const prompt = model.requests[0]?.user ?? '';
    expect(prompt).not.toContain('cr_in_04');
    expect(prompt).not.toContain('in_04');
    expect(prompt).not.toContain('hist_kenji_0142');
    // …but the facts the sentence needs are there, split by payee.
    expect(prompt).toContain('payeeOnFile');
    expect(prompt).toContain('verifiedAt');
    expect(prompt).toContain('requestedPayee');
    expect(prompt).toContain('"verified": false');
  });

  it('gives the model the delivery in human words, not del_leo_02', async () => {
    const model = new ScriptedModel([
      {
        content: JSON.stringify({
          text: 'The invoice bills 40 hours against a 32-hour cap, and the work is not accepted. A human must decide what to pay.',
        }),
      },
    ]);
    await explainIntent(
      input({ itemId: 'in_05', decision: 'held', checks: [OVER_CAP, NOT_ACCEPTED], claim: claim({ itemId: 'in_05', invoiceNumber: 'INV-031', vendorName: 'Leo Martin' }) }),
      { model },
    );
    const prompt = model.requests[0]?.user ?? '';
    expect(prompt).not.toContain('del_leo_02');
    expect(prompt).toContain("Leo Martin's delivery");
  });
});
