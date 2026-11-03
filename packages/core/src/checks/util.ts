import type { CheckId, CheckResult, CheckStatus } from '../types.js';

export function result(
  id: CheckId,
  status: CheckStatus,
  code: string,
  facts: CheckResult['facts'] = {},
): CheckResult {
  return { id, status, code, facts };
}

/** O1 did not pass → SPEC §6.2.2 says O2–O3, P1–P2, L3 are recorded as `na`. */
export function na(id: CheckId): CheckResult {
  return result(id, 'na', 'NOT_APPLICABLE');
}

export function statusOf(results: readonly CheckResult[], id: CheckId): CheckStatus {
  return results.find((r) => r.id === id)?.status ?? 'na';
}
