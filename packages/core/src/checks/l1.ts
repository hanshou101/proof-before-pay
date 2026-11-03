// L1 — per-payment limit. SPEC §6.2.2.
//
// The amount judged is the one that would actually leave the account: a human-approved
// lower amount when present, otherwise the invoiced total.

import type { CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { result } from './util.js';

export function effectiveAmount(deps: CheckDeps): number {
  return deps.context.approvedAmount ?? deps.proposal.claim.total;
}

export function checkL1(deps: CheckDeps): CheckResult {
  const amount = effectiveAmount(deps);
  const limit = deps.context.policy.perPaymentAutoLimit;

  return amount > limit
    ? result('L1', 'hold', 'OVER_LIMIT', { amount, limit })
    : result('L1', 'pass', 'WITHIN_LIMIT', { amount, limit });
}
