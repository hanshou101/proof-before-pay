// Step 3 (SPEC §6.6.2): no PO → pick one of *this vendor's* agreements, with a reason.
//
// The parser is the point of the test: a model that names an agreement outside the candidate
// list must be rejected, not trusted. Two failures mean `agreementId: null` and the gate's O2
// NO_AGREEMENT holds the payment — never "the only agreement, probably".

import { describe, expect, it } from 'vitest';
import type { Claim, Vendor } from '@pbp/core';
import { matchAgreement } from '../src/match.js';
import { demo, recording, ScriptedModel } from './helpers.js';

const sofia = demo.vendors.find((vendor) => vendor.id === 'ven_sofia') as Vendor;

function noPoClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    itemId: 'in_06',
    vendorId: 'ven_sofia',
    vendorName: 'Sofia Rossi',
    senderEmail: 'sofia@linguaviva.example',
    invoiceNumber: '1009',
    issueDate: '2026-10-30',
    currency: 'USD',
    total: 73800,
    po: null,
    requestedPayee: null,
    lines: [{ description: 'Brand guidelines translation', quantity: 8200, unit: 'word', unitPrice: 9, amount: 73800 }],
    sourceSha256: 'b'.repeat(64),
    extractedBy: null,
    ...overrides,
  };
}

describe('matchAgreement', () => {
  it('returns the recorded choice for in_06 (agr_sofia_05, the agreement without a PO)', async () => {
    const model = new ScriptedModel([{ content: recording('in_06-match').content }]);
    const result = await matchAgreement(
      { claim: noPoClaim(), vendor: sofia, agreements: demo.agreements },
      { model },
    );

    expect(result).toMatchObject({ agreementId: 'agr_sofia_05', matchedBy: 'ai', needsReview: false, attempts: 1 });
    expect(result.rationale).toMatch(/translation/i);
  });

  it('offers the model only the vendor’s own agreements', async () => {
    const model = new ScriptedModel([{ content: recording('in_06-match').content }]);
    await matchAgreement({ claim: noPoClaim(), vendor: sofia, agreements: demo.agreements }, { model });

    const user = model.requests[0]?.user ?? '';
    expect(user).toContain('agr_sofia_05');
    expect(user).toContain('agr_sofia_04');
    expect(user).not.toContain('agr_priya_03');
    expect(user).not.toContain('agr_kenji_11');
  });

  it('rejects an agreement id that is not this vendor’s, then gives up honestly', async () => {
    const foreign = '{"agreementId":"agr_priya_03","reason":"It looked similar."}';
    const model = new ScriptedModel([{ content: foreign }, { content: foreign }]);
    const result = await matchAgreement(
      { claim: noPoClaim(), vendor: sofia, agreements: demo.agreements },
      { model },
    );

    expect(result.agreementId).toBeNull();
    expect(result.matchedBy).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.error).toContain("not one of this vendor's agreements");
    expect(model.requests[1]?.user).toContain('did not pass validation');
  });

  it('returns NO_AGREEMENT material without calling the model when the vendor has no agreement', async () => {
    const model = new ScriptedModel([]);
    const result = await matchAgreement(
      { claim: noPoClaim(), vendor: sofia, agreements: demo.agreements.filter((a) => a.vendorId !== 'ven_sofia') },
      { model },
    );

    expect(result.agreementId).toBeNull();
    expect(result.needsReview).toBe(false);
    expect(result.attempts).toBe(0);
    expect(model.requests).toHaveLength(0);
    expect(result.rationale).toContain('the gate will hold');
  });
});
