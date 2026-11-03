// O4 — have we already paid this? SPEC §6.2.2 / §6.2.4.
//
// Same fingerprint + a live intent in approved / submitted / awaiting / proven → fail
// `DUPLICATE` pointing at the original. rejected / failed / cancelled originals do not block
// a fresh attempt.
//
// Seeded history is different: SPEC v1.1 §6.2.2 says history *always* counts as proven,
// whatever state the record carries (the scenario file has no `state` column at all), and
// O4 reports `originalState: "proven"` for it.

import { fingerprint } from '../fingerprint.js';
import type { CheckResult } from '../types.js';
import type { CheckDeps, IntentState } from '../context.js';
import { result } from './util.js';

const LIVE_STATES: ReadonlySet<IntentState> = new Set<IntentState>([
  'approved',
  'submitted',
  'awaiting',
  'proven',
]);

export function intentFingerprint(deps: CheckDeps): string {
  const claim = deps.proposal.claim;
  return fingerprint({
    vendorId: deps.vendor?.id ?? claim.vendorId ?? 'unknown',
    invoiceNumber: claim.invoiceNumber,
    currency: claim.currency,
    total: claim.total,
  });
}

export function checkO4(deps: CheckDeps): CheckResult {
  const { context } = deps;
  const fp = intentFingerprint(deps);

  const duplicate = context.intents.find(
    (intent) => intent.fingerprint === fp && LIVE_STATES.has(intent.state),
  );
  if (duplicate) {
    return result('O4', 'fail', 'DUPLICATE', {
      duplicateOf: duplicate.id,
      originalState: duplicate.state,
      transactionId: duplicate.transactionId ?? null,
      fingerprint: fp,
    });
  }

  // Seeded history: proven by definition, never read `record.state`.
  const seeded = context.history.find((record) => record.fingerprint === fp);
  if (seeded) {
    return result('O4', 'fail', 'DUPLICATE', {
      duplicateOf: seeded.id,
      originalState: 'proven',
      transactionId: seeded.transactionId ?? null,
      fingerprint: fp,
    });
  }

  return result('O4', 'pass', 'NOT_DUPLICATE', { fingerprint: fp });
}
