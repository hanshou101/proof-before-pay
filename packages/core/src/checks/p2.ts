// P2 — is there an unverified bank-details change request? SPEC §6.2.2.
//
// Any `unverified` request for this vendor inside `changeRequestWindowDays` holds the
// payment. Only a human `verify_payee` with result `confirmed` clears it (SPEC §6.3.3).

import type { CheckResult } from '../types.js';
import type { CheckDeps } from '../context.js';
import { na, result, statusOf } from './util.js';

export function checkP2(deps: CheckDeps): CheckResult {
  const { context, vendor } = deps;

  if (statusOf(deps.results, 'O1') !== 'pass' || !vendor) return na('P2');

  const windowMs = context.policy.changeRequestWindowDays * 24 * 60 * 60 * 1000;
  const now = Date.parse(context.now);

  const pending = context.changeRequests
    .filter((request) => request.vendorId === vendor.id && request.status === 'unverified')
    .filter((request) => now - Date.parse(request.requestedAt) <= windowMs)
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));

  const latest = pending[0];
  if (!latest) {
    return result('P2', 'pass', 'NO_CHANGE_REQUEST', {
      vendorId: vendor.id,
      windowDays: context.policy.changeRequestWindowDays,
    });
  }

  return result('P2', 'hold', 'CHANGE_REQUEST_PENDING', {
    requestId: latest.id,
    requestedAt: latest.requestedAt,
    sourceItemId: latest.sourceItemId,
    requestedPayee: latest.requestedPayee,
  });
}
