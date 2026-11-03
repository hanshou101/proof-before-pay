// P1 — is the payee the one we verified? SPEC §6.2.2.
//
// Empty `requestedPayee` means "pay the on-file payee". A non-empty one must equal the
// on-file payee case-insensitively; anything else holds, even if it looks legitimate.

import type { CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { normalizeEmail } from '../normalize.js';
import { na, result, statusOf } from './util.js';

export function checkP1(deps: CheckDeps): CheckResult {
  const { proposal, vendor } = deps;

  if (statusOf(deps.results, 'O1') !== 'pass' || !vendor) return na('P1');

  const onFile = vendor.payee.receiver;
  const requestedRaw = (proposal.claim.requestedPayee ?? '').trim();
  const requested = requestedRaw === '' ? onFile : requestedRaw;

  const facts: CheckResult['facts'] = {
    onFile,
    requested,
    verifiedAt: vendor.payeeVerified.at,
    method: vendor.payeeVerified.method,
  };

  if (normalizeEmail(requested) !== normalizeEmail(onFile)) {
    return result('P1', 'hold', 'PAYEE_MISMATCH', facts);
  }

  return result('P1', 'pass', 'PAYEE_VERIFIED', facts);
}
