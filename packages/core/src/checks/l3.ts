// L3 — first payment to a brand-new vendor. SPEC §6.2.2.
//
// `priorPayments === 0` means we have never paid them: the first payment is capped by
// `newVendorAutoLimit`. Anyone we have paid before is established and only L1/L2 apply.

import type { CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { na, result, statusOf } from './util.js';
import { effectiveAmount } from './l1.js';

export function checkL3(deps: CheckDeps): CheckResult {
  const { context, vendor } = deps;

  if (statusOf(deps.results, 'O1') !== 'pass' || !vendor) return na('L3');

  const amount = effectiveAmount(deps);
  const limit = context.policy.newVendorAutoLimit;
  const priorPayments = vendor.priorPayments;

  if (priorPayments > 0) {
    return result('L3', 'pass', 'VENDOR_ESTABLISHED', { priorPayments, amount, limit });
  }

  return amount > limit
    ? result('L3', 'hold', 'NEW_VENDOR_OVER_LIMIT', { priorPayments, amount, limit })
    : result('L3', 'pass', 'NEW_VENDOR_WITHIN_LIMIT', { priorPayments, amount, limit });
}
