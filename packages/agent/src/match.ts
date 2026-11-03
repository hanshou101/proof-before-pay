// Step 3 — agreement matching for an invoice without a PO (SPEC §6.6.2 step 3).
//
// The candidates are the vendor's own agreements only, and the parser rejects any id outside
// that list, so a model that hallucinates an agreement id can never widen its own choice. If two
// valid attempts fail, the result is `agreementId: null` — the gate then reports O2
// `NO_AGREEMENT` and holds the payment. Falling back to "the only agreement" would be a guess
// dressed as a decision.

import type { Agreement, Claim, Vendor } from '@pbp/core';
import { formatMoney } from './money.js';
import { MATCH_SYSTEM, matchUser } from './prompts/match.js';
import { matchSchema } from './schema.js';
import type { AgentContext } from './types.js';
import { ValidationError, askJson, parseJsonObject } from './validate.js';

export interface MatchResult {
  agreementId: string | null;
  matchedBy: 'ai' | null;
  rationale: string;
  attempts: number;
  needsReview: boolean;
  error: string | null;
}

export async function matchAgreement(
  input: { claim: Claim; vendor: Vendor; agreements: Agreement[] },
  ctx: Pick<AgentContext, 'model'>,
): Promise<MatchResult> {
  const candidates = input.agreements.filter((agreement) => agreement.vendorId === input.vendor.id);

  if (candidates.length === 0) {
    return {
      agreementId: null,
      matchedBy: null,
      rationale: `No agreement on file for ${input.vendor.name}; the gate will hold this invoice.`,
      attempts: 0,
      needsReview: false,
      error: null,
    };
  }

  const ids = new Set(candidates.map((agreement) => agreement.id));
  const description = input.claim.lines
    .map((line) => `${line.description} (${line.quantity} ${line.unit})`)
    .join('; ');

  const result = await askJson<{ agreementId: string; reason: string }>({
    model: ctx.model,
    step: 'match',
    itemId: input.claim.itemId,
    system: MATCH_SYSTEM,
    user: matchUser({
      vendorId: input.vendor.id,
      vendorName: input.vendor.name,
      invoiceNumber: input.claim.invoiceNumber,
      invoiceDescription: description,
      totalLabel: `$${formatMoney(input.claim.total)}`,
      candidates,
    }),
    parse: (content) => {
      const parsed = matchSchema.safeParse(parseJsonObject(content));
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
        );
      }
      if (!ids.has(parsed.data.agreementId)) {
        throw new ValidationError(
          `agreementId ${JSON.stringify(parsed.data.agreementId)} is not one of this vendor's agreements: ${[...ids].join(', ')}`,
        );
      }
      return parsed.data;
    },
  });

  if (!result.ok || result.value === null) {
    return {
      agreementId: null,
      matchedBy: null,
      rationale: 'The AI could not pick an agreement for this invoice; the gate will hold it for a human.',
      attempts: result.attempts,
      needsReview: true,
      error: result.error,
    };
  }

  return {
    agreementId: result.value.agreementId,
    matchedBy: 'ai',
    rationale: result.value.reason,
    attempts: result.attempts,
    needsReview: false,
    error: null,
  };
}
