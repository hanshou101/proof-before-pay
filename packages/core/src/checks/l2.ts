// L2 — daily limit. SPEC §6.2.2 (v1.1).
//
// `todayTotal` is every approved / submitted / awaiting / proven amount already booked
// on the same UTC day as `context.now`, excluding this proposal (matched by fingerprint);
// seeded history counts as proven regardless of the record's `state`.
//
// Both sides of the comparison use the money that will actually leave the account:
// `approvedAmount ?? amount` per booked entry, and `effectiveAmount(deps)` for this one
// (SPEC v1.1 §6.2.2 last bullet).

import type { CheckResult } from '../types.js';
import type { CheckDeps, HistoryRecord, IntentState } from '../context.js';
import { intentFingerprint } from './o4.js';
import { effectiveAmount } from './l1.js';
import { result } from './util.js';

const BOOKED_STATES: ReadonlySet<IntentState> = new Set<IntentState>([
  'approved',
  'submitted',
  'awaiting',
  'proven',
]);

export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** What a booked entry actually pays out — a human-lowered amount wins over the billed one. */
function spentAmount(entry: { amount: number; approvedAmount?: number | null }): number {
  return entry.approvedAmount ?? entry.amount;
}

export function checkL2(deps: CheckDeps): CheckResult {
  const { context } = deps;
  const day = utcDay(context.now);
  const self = intentFingerprint(deps);
  const limit = context.policy.dailyLimit;

  const liveTotal = context.intents
    .filter((intent) => BOOKED_STATES.has(intent.state))
    .filter((intent) => intent.fingerprint !== self)
    .filter((intent) => utcDay(intent.at) === day)
    .reduce((sum, intent) => sum + spentAmount(intent), 0);

  // Seeded history is proven by definition (SPEC §6.2.2 O4 / v1.1), so its `state` — when it
  // has one at all — is never consulted. `HistoryRecord` is the only place a missing state
  // is allowed, which keeps this filter honest.
  const historyTotal = context.history
    .filter((record: HistoryRecord) => record.fingerprint !== self)
    .filter((record) => utcDay(record.at) === day)
    .reduce((sum, record) => sum + spentAmount(record), 0);

  const todayTotal = liveTotal + historyTotal;
  const amount = effectiveAmount(deps);

  return todayTotal + amount > limit
    ? result('L2', 'hold', 'OVER_DAILY_LIMIT', { todayTotal, amount, limit })
    : result('L2', 'pass', 'WITHIN_DAILY_LIMIT', { todayTotal, amount, limit });
}
