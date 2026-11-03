// The proof gate. SPEC §6.2.
//
// `evaluate` is a pure function: same proposal + same context → byte-identical result.
// It never talks to the network, the filesystem or the wall clock (`context.now` is the
// only clock). The LLM proposes; this decides.

import type { CheckResult, Decision, Proposal } from './types.js';
import type { CheckDeps, GateContext } from './context.js';
import { CHECK_ORDER, resolveVendor } from './checks/index.js';

export type SealGroup = 'owed' | 'payee' | 'policy';

export interface GateEvaluation {
  checks: CheckResult[];
  decision: Decision;
}

const SEAL_GROUPS: Record<SealGroup, readonly string[]> = {
  owed: ['O1', 'O2', 'O3', 'O4'],
  payee: ['P1', 'P2'],
  policy: ['L1', 'L2', 'L3'],
};

export function evaluate(proposal: Proposal, context: GateContext): GateEvaluation {
  const { vendor, matchedBy } = resolveVendor(proposal.claim, context);
  const agreement = proposal.agreementId
    ? (context.agreements.find((a) => a.id === proposal.agreementId) ?? null)
    : null;

  const base: Omit<CheckDeps, 'results'> = {
    proposal,
    context,
    vendor,
    vendorMatchedBy: matchedBy,
    agreement,
  };

  const checks: CheckResult[] = [];
  for (const check of CHECK_ORDER) {
    checks.push(check({ ...base, results: checks }));
  }

  return { checks, decision: decide(checks) };
}

/** SPEC §6.2.2: any fail → blocked; else any hold → held; else approved. */
export function decide(checks: readonly CheckResult[]): Decision {
  if (checks.some((check) => check.status === 'fail')) return 'blocked';
  if (checks.some((check) => check.status === 'hold')) return 'held';
  return 'approved';
}

/**
 * The stamp status for one seal group (Owed / Payee / Policy): the worst status in the
 * group, `fail > hold > pass`; `na` only when the whole group is not applicable.
 */
export function sealOf(checks: readonly CheckResult[], group: SealGroup): 'pass' | 'hold' | 'fail' | 'na' {
  const wanted = new Set<string>(SEAL_GROUPS[group]);
  const picked = checks.filter((check) => wanted.has(check.id));
  if (picked.some((check) => check.status === 'fail')) return 'fail';
  if (picked.some((check) => check.status === 'hold')) return 'hold';
  if (picked.some((check) => check.status === 'pass')) return 'pass';
  return 'na';
}

/** The check that produced the worst status in a group — what the UI explains. */
export function sealReason(checks: readonly CheckResult[], group: SealGroup): CheckResult | null {
  const wanted = new Set<string>(SEAL_GROUPS[group]);
  const picked = checks.filter((check) => wanted.has(check.id));
  const rank = (status: CheckResult['status']): number =>
    status === 'fail' ? 3 : status === 'hold' ? 2 : status === 'pass' ? 1 : 0;
  let worst: CheckResult | null = null;
  for (const check of picked) {
    if (!worst || rank(check.status) > rank(worst.status)) worst = check;
  }
  return worst;
}

/**
 * SPEC §6.3.3 / AC-3: while an unverified payee change is in play, "Approve" must be refused.
 * Returns the P1/P2 result that blocks a human approval, or null when approval is allowed.
 * The server calls this before accepting `human.action: approve`.
 */
export function approveBlockedBy(checks: readonly CheckResult[]): CheckResult | null {
  return (
    checks.find(
      (check) =>
        (check.id === 'P1' || check.id === 'P2') &&
        (check.status === 'hold' || check.status === 'fail'),
    ) ?? null
  );
}


